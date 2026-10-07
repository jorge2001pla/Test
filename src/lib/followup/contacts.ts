/**
 * Unified Log Contact. One entry per contact; attempted vs. reached are separate facts. The
 * outcome drives task completion and the NEXT ACTION, so nothing a call produces can leave a
 * client without a next step. Fully idempotent by `idemKey` and applied as one atomic batch.
 */
import { commissionStatus } from "./commission";
import type { FollowUpConfig } from "./config";
import {
  addWorkdays,
  etDate,
  isDateStr,
  nextAllowedSlot,
  nextWorkdayOnOrAfter,
  utcToNaiveEt,
  type DateStr,
} from "./dates";
import { legacyLogStmts, linkedRecords } from "./legacy";
import {
  CHANNEL_LABELS,
  OBJECTIONS,
  OUTCOME_LABELS,
  isCall,
  traits,
  validateContactInput,
  type Channel,
  type Outcome,
} from "./outcomes";
import { recordSale, type RecordSaleInput, type RecordSaleResult } from "./sales";
import { afterChange } from "./tasks";
import {
  closeTask,
  getConfig,
  getParty,
  insertTask,
  iso,
  logTaskEvent,
  partyZone,
  pendingTasks,
  q,
  rescheduleTask,
  run,
  uuid,
  type Party,
  type Stmt,
  type TaskRow,
} from "./store";

export interface LogContactInput {
  partyId: string;
  channel: Channel;
  outcome: Outcome;
  voicemailLeft?: boolean;
  occurredAt?: Date;
  purpose?: string | null;
  taskId?: string | null;
  shipmentId?: string | null;
  pitch?: string | null;
  objection?: string | null;
  objectionNote?: string | null;
  nextActionDate?: DateStr | null;
  nextActionNote?: string | null;
  callbackAt?: Date | null;
  notes?: string | null;
  satisfaction?: string | null;
  promotionId?: string | null;
  sale?: Omit<RecordSaleInput, "partyId" | "idemKey" | "now"> | null;
  idemKey: string;
  now?: Date;
}

export interface LogContactResult {
  ok: boolean;
  error?: string;
  duplicate?: boolean;
  contactId?: string;
  sale?: RecordSaleResult;
  /** Human summary of the next action after this contact. */
  nextAction?: string | null;
  completed: number;
  rescheduled: number;
}

const objLabel = (k?: string | null) => OBJECTIONS.find((o) => o.key === k)?.label ?? k ?? "";

export async function logContact(input: LogContactInput): Promise<LogContactResult> {
  const now = input.now ?? new Date();
  const today = etDate(now);
  const occurred = input.occurredAt && input.occurredAt <= now ? input.occurredAt : now;

  const existing = await q<{ id: string }>("SELECT id FROM fu_contacts WHERE idem_key = ?", [input.idemKey]);
  if (existing.length) {
    let sale: RecordSaleResult | undefined;
    if (input.outcome === "SOLD" && input.sale) {
      sale = await recordSale({ ...input.sale, partyId: input.partyId, idemKey: `${input.idemKey}:sale`, now });
    }
    return { ok: true, duplicate: true, contactId: existing[0].id, sale, completed: 0, rescheduled: 0 };
  }

  const err = validateContactInput({
    outcome: input.outcome,
    channel: input.channel,
    objection: input.objection,
    nextActionDate: input.nextActionDate,
    callbackAt: input.callbackAt ? "x" : null,
  });
  if (err) return fail(err);
  if (input.nextActionDate && !isDateStr(input.nextActionDate)) return fail("Invalid next action date.");
  if (input.callbackAt && input.callbackAt.getTime() < now.getTime() - 60_000) return fail("Pick a callback time in the future.");
  if (input.outcome === "SOLD" && !input.sale) return fail("Enter the sale details to record a sale.");

  const party = await getParty(input.partyId);
  if (!party) return fail("Client not found.");
  const cfg = await getConfig();
  const tr = traits(input.outcome, input.channel);
  const call = isCall(input.channel);
  const pend = await pendingTasks(party.id);
  const contactId = uuid();
  const ts = iso(occurred);
  const stmts: Stmt[] = [];
  let completed = 0;
  let rescheduled = 0;

  // Resolve which shipment (if any) this contact is about.
  const linkedTask = input.taskId ? pend.find((t) => t.id === input.taskId) : undefined;
  let shipmentId = input.shipmentId ?? linkedTask?.shipment_id ?? null;
  if (!shipmentId && input.outcome === "DELIVERY_CONFIRMED") {
    const d = pend.filter((t) => t.category === "DELIVERY");
    if (d.length === 1) shipmentId = d[0].shipment_id;
  }

  stmts.push({
    sql: `INSERT INTO fu_contacts (id, party_id, occurred_at, channel, direction, outcome, attempted, reached, voicemail_left,
            purpose, task_id, cycle_id, shipment_id, pitch, objection_category, objection_note, next_action, notes,
            receipt_confirmed, idem_key, created_at)
          VALUES (?,?,?,?, 'OUT', ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [contactId, party.id, ts, input.channel, input.outcome, 1, tr.reached ? 1 : 0,
      input.voicemailLeft && call ? 1 : 0, input.purpose ?? linkedTask?.purpose ?? null, input.taskId ?? null,
      linkedTask?.cycle_id ?? (await activeCycleId(party.id)), shipmentId, input.pitch ?? null,
      input.objection ?? null, input.objectionNote ?? null,
      input.nextActionNote ?? (input.nextActionDate ? `Next: ${input.nextActionDate}` : null),
      input.notes ?? null, input.outcome === "DELIVERY_CONFIRMED" ? 1 : 0, input.idemKey, iso(now)],
  });

  // ── Close out tasks this contact satisfies ────────────────────────────────
  const closed = new Set<string>();
  const done = (t: TaskRow, reason: string) => {
    stmts.push(...closeTask(t.id, "COMPLETED", reason, now, contactId));
    closed.add(t.id);
    completed++;
  };
  const supersede = (t: TaskRow, reason: string, missed = false) => {
    if (closed.has(t.id)) return;
    if (missed) stmts.push(logTaskEvent(t.id, "MISSED", "Step was due and not done", now));
    stmts.push(...closeTask(t.id, "SUPERSEDED", reason, now, contactId));
    closed.add(t.id);
  };
  const retryNextWorkday = (t: TaskRow, why: string) => {
    const nd = nextWorkdayOnOrAfter(addDaysET(today, 1), cfg);
    if (t.due_at) {
      const { tz } = partyZone(party, cfg);
      const slot = nextAllowedSlot(new Date(`${nd}T12:00:00Z`), tz, cfg);
      stmts.push(...rescheduleTask(t.id, etDate(slot), iso(slot), why, now));
    } else {
      stmts.push(...rescheduleTask(t.id, nd, null, why, now));
    }
    closed.add(t.id);
    rescheduled++;
  };
  const label = `${OUTCOME_LABELS[input.outcome]}${input.voicemailLeft && call ? " + voicemail" : ""}`;
  const isLinked = (t: TaskRow) => t.id === input.taskId;
  const dueNow = (t: TaskRow) => (t.due_at ? new Date(t.due_at) <= now : t.due_date <= today);

  if (call) {
    // Cadence: the attempt IS the step. The latest due step completes; older due steps were missed
    // and are folded away — one call never answers for several steps and never spawns catch-ups.
    const cadDue = pend.filter((t) => t.category === "CADENCE" && t.due_date <= today)
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || (a.cadence_day ?? 0) - (b.cadence_day ?? 0));
    if (cadDue.length && !["STOP_CONTACT", "GHOST"].includes(input.outcome)) {
      const last = cadDue[cadDue.length - 1];
      for (const m of cadDue.slice(0, -1)) supersede(m, "Missed — rolled into a later step", true);
      done(last, `Attempted: ${label}`);
    }
  }

  for (const t of pend) {
    if (closed.has(t.id)) continue;
    if (t.category === "CADENCE" && t.type === "TEXT" && input.channel === "TEXT" && (isLinked(t) || t.due_date <= today)) {
      done(t, `Text sent`);
      continue;
    }
    if (!call) continue; // texts/emails only satisfy text steps (handled above)

    if (t.category === "CALLBACK" && (isLinked(t) || dueNow(t))) {
      if (tr.reached) done(t, `Callback reached: ${label}`);
      else if (!["STOP_CONTACT", "GHOST"].includes(input.outcome)) {
        retryNextWorkday(t, `Unanswered callback attempt (${label}) — retry next allowed slot`);
      }
    } else if (t.category === "DELIVERY" && (isLinked(t) || (shipmentId && t.shipment_id === shipmentId) || t.due_date <= today)) {
      if (input.outcome === "DELIVERY_CONFIRMED" && (!shipmentId || t.shipment_id === shipmentId)) {
        done(t, "Client confirmed receipt");
      } else if (!["STOP_CONTACT", "GHOST"].includes(input.outcome)) {
        // An unanswered (or unconfirmed) call never completes a delivery check-in.
        retryNextWorkday(t, `Receipt not confirmed (${label}) — retry next workday`);
      }
    } else if (t.category === "SHIPMENT" && t.type === "CALL" && (isLinked(t) || t.due_date <= today)) {
      if (tr.reached) {
        done(t, `Shipped call: ${label}`);
        if (t.shipment_id) {
          stmts.push({ sql: "UPDATE shipments SET shipped_call_done = 1, updated_at = datetime('now') WHERE id = ?", args: [t.shipment_id] });
        }
      } else if (!["STOP_CONTACT", "GHOST"].includes(input.outcome)) {
        retryNextWorkday(t, `Not reached (${label}) — retry next workday`);
      }
    } else if (t.category === "REACTIVATION" && (isLinked(t) || t.due_date <= today)) {
      if (tr.reached) done(t, `Reactivation: ${label}`);
      else if (!["STOP_CONTACT", "GHOST"].includes(input.outcome)) {
        const tries = (await q<{ n: number }>("SELECT COUNT(*) AS n FROM fu_contacts WHERE party_id = ? AND task_id = ?", [party.id, t.id]))[0]?.n ?? 0;
        if (Number(tries) + 1 >= 3) {
          stmts.push(...closeTask(t.id, "CANCELLED", "No response after 3 reactivation attempts", now, contactId));
          closed.add(t.id);
        } else {
          const nd = addWorkdays(today, 3, cfg);
          stmts.push(...rescheduleTask(t.id, nd, null, `Not reached (${label}) — retry in 3 workdays`, now));
          closed.add(t.id);
          rescheduled++;
        }
      }
    } else if (t.category === "MANUAL" && t.type === "CALL" && (isLinked(t) || t.due_date <= today)) {
      if (tr.reached) done(t, `Done: ${label}`);
      else if (!["STOP_CONTACT", "GHOST"].includes(input.outcome)) retryNextWorkday(t, `Not reached (${label}) — retry next workday`);
    }
  }

  // ── Party facts ──────────────────────────────────────────────────────────
  let restrictions = { ...party.restrictions };
  const sets: string[] = ["last_attempt_at = CASE WHEN last_attempt_at IS NULL OR last_attempt_at < ? THEN ? ELSE last_attempt_at END", "updated_at = ?"];
  const args: (string | number | null)[] = [ts, ts, iso(now)];
  if (tr.reached) { sets.push("last_conversation_at = CASE WHEN last_conversation_at IS NULL OR last_conversation_at < ? THEN ? ELSE last_conversation_at END"); args.push(ts, ts); }
  if (input.pitch?.trim()) { sets.push("last_pitch = ?"); args.push(input.pitch.trim()); }
  if (input.objection) { sets.push("last_objection = ?"); args.push(objLabel(input.objection)); }

  // ── Suppression outcomes ─────────────────────────────────────────────────
  const suppress = input.outcome === "GHOST" || input.outcome === "STOP_CONTACT";
  if (suppress) {
    const why = input.outcome === "GHOST" ? "GHOST — outreach suppressed" : "Client asked to stop contact";
    for (const t of pend) {
      if (closed.has(t.id) || t.category === "SERVICE") continue; // unresolved service records survive
      if (t.category === "SHIPMENT" && t.type === "TASK") continue; // internal data-entry obligation
      stmts.push(...closeTask(t.id, "CANCELLED", why, now, contactId));
      closed.add(t.id);
    }
    stmts.push({
      sql: `UPDATE fu_cycles SET status = 'CLOSED', close_reason = ?, closed_at = ? WHERE party_id = ? AND status = 'ACTIVE'`,
      args: [input.outcome === "GHOST" ? "GHOST" : "DO_NOT_CONTACT", iso(now), party.id],
    });
    sets.push("reactivation_state = 'NONE'");
    if (input.outcome === "GHOST") { sets.push("ghost = 1", "ghost_at = ?"); args.push(iso(now)); }
    else restrictions = { ...restrictions, doNotContact: true };
  }
  if (input.outcome === "STOP_CONTACT") {
    sets.push("restrictions = ?"); args.push(JSON.stringify(restrictions));
  }

  // ── Next-action generation ───────────────────────────────────────────────
  let nextAction: string | null = null;
  const stillPending = () => pend.filter((t) => !closed.has(t.id));

  if (!suppress) {
    if (input.outcome === "CALLBACK_SET" && input.callbackAt) {
      const when = input.callbackAt;
      const whenDate = etDate(when);
      for (const t of stillPending()) {
        if (t.category === "CALLBACK") supersede(t, "Replaced by a newer callback request");
        else if (t.category === "CADENCE" && t.due_date <= whenDate) supersede(t, "Covered by the promised callback");
      }
      const minute = utcToNaiveEt(when);
      stmts.push(...insertTask({
        partyId: party.id, cycleId: await activeCycleId(party.id), category: "CALLBACK", type: "CALL",
        purpose: input.nextActionNote?.trim() || "Promised callback", dueDate: whenDate, dueAt: iso(when),
        dedupeKey: `cb:${party.id}:${minute}`,
      }, now).stmts);
      nextAction = `Callback ${whenDate}`;
    } else if ((input.outcome === "SPOKE" || input.outcome === "DECLINED") && input.nextActionDate) {
      const d = nextWorkdayOnOrAfter(input.nextActionDate, cfg);
      for (const t of stillPending()) {
        if (t.category === "CADENCE" && t.due_date < d) supersede(t, `Conversation set the next action for ${d}`);
      }
      const why = input.outcome === "DECLINED" ? `Follow up after decline (${objLabel(input.objection)})` : "Follow up";
      stmts.push(...insertTask({
        partyId: party.id, cycleId: await activeCycleId(party.id), category: "MANUAL", type: "CALL",
        purpose: input.nextActionNote?.trim() || why, dueDate: d, dedupeKey: `next:${contactId}`,
      }, now).stmts);
      nextAction = `${input.nextActionNote?.trim() || why} — ${d}`;
    } else if (input.nextActionDate && input.outcome !== "SOLD" && input.outcome !== "DELIVERY_CONFIRMED") {
      const d = nextWorkdayOnOrAfter(input.nextActionDate, cfg);
      stmts.push(...insertTask({
        partyId: party.id, cycleId: await activeCycleId(party.id), category: "MANUAL", type: "CALL",
        purpose: input.nextActionNote?.trim() || "Follow up", dueDate: d, dedupeKey: `next:${contactId}`,
      }, now).stmts);
      nextAction = `${input.nextActionNote?.trim() || "Follow up"} — ${d}`;
    }

    // No answer on a person with no remaining planned step: schedule the next eligible retry
    // so an in-window client never silently loses its next action.
    if (!nextAction && (input.outcome === "NO_ANSWER" || input.outcome === "AI_SCREENING") && call) {
      const open = stillPending().some((t) => ["CADENCE", "CALLBACK", "MANUAL", "REACTIVATION"].includes(t.category) && t.due_date > today);
      const inWindow = commissionStatus(party.openingDate, today).eligibility === "IN_WINDOW";
      if (!open && inWindow) {
        const d = addWorkdays(today, 2, cfg);
        stmts.push(...insertTask({
          partyId: party.id, cycleId: await activeCycleId(party.id), category: "MANUAL", type: "CALL",
          purpose: input.outcome === "AI_SCREENING" ? "Retry — previous call hit AI screening" : "Retry — no answer",
          dueDate: d, dedupeKey: `next:${contactId}`,
        }, now).stmts);
        nextAction = `Retry — ${d}`;
      }
    }
    if (!nextAction) {
      const up = stillPending().filter((t) => t.status === "PENDING")
        .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
      if (up) nextAction = `${up.purpose} — ${up.due_date}`;
    }
  }

  // ── Delivery confirmation bookkeeping ────────────────────────────────────
  if (input.outcome === "DELIVERY_CONFIRMED" && shipmentId) {
    stmts.push({
      sql: `UPDATE shipments SET receipt_confirmed_at = COALESCE(receipt_confirmed_at, ?), delivered_call_done = 1,
              satisfaction = COALESCE(?, satisfaction), updated_at = datetime('now') WHERE id = ?`,
      args: [ts, input.satisfaction ?? null, shipmentId],
    });
  }

  stmts.push({ sql: `UPDATE parties SET ${sets.join(", ")} WHERE id = ?`, args: [...args, party.id] });

  // ── Legacy mirror (history + color + dispo) ──────────────────────────────
  const noteBits = [`${CHANNEL_LABELS[input.channel]}: ${label}`];
  if (input.objection) noteBits.push(`Objection: ${objLabel(input.objection)}${input.objectionNote ? ` (${input.objectionNote})` : ""}`);
  if (input.pitch?.trim()) noteBits.push(`Pitch: ${input.pitch.trim()}`);
  if (input.purpose) noteBits.push(`Purpose: ${input.purpose}`);
  if (input.notes?.trim()) noteBits.push(input.notes.trim());
  stmts.push(...legacyLogStmts(await linkedRecords(party.id), noteBits.join(" · "), tr.legacyStatus && input.outcome !== "DELIVERY_CONFIRMED" ? tr.legacyStatus : null, occurred, {
    promotionId: input.promotionId ?? null,
    completeReminders: tr.reached && call,
  }));

  await run(stmts);
  await afterChange(party.id, now);

  let sale: RecordSaleResult | undefined;
  if (input.outcome === "SOLD" && input.sale) {
    sale = await recordSale({ ...input.sale, partyId: party.id, idemKey: `${input.idemKey}:sale`, now });
    if (sale.ok && sale.nextAction) nextAction = `${sale.nextAction.purpose} — ${sale.nextAction.dueDate}`;
    if (!sale.ok) return { ok: false, error: `Contact logged, but the sale failed: ${sale.error}`, contactId, completed, rescheduled };
  }
  return { ok: true, contactId, sale, nextAction, completed, rescheduled };
}

function fail(error: string): LogContactResult {
  return { ok: false, error, completed: 0, rescheduled: 0 };
}

async function activeCycleId(partyId: string): Promise<string | null> {
  const r = await q<{ id: string }>("SELECT id FROM fu_cycles WHERE party_id = ? AND status = 'ACTIVE'", [partyId]);
  return r[0]?.id ?? null;
}

function addDaysET(date: DateStr, n: number): DateStr {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type { Party, FollowUpConfig };
