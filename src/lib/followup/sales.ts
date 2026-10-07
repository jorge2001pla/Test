/**
 * Record Sale: order → (re)start the 30-day cycle → supersede stale sales cadence → generate the
 * next actions → shipment obligations. One atomic batch, fully idempotent by `idemKey`.
 * Callbacks, undelivered orders, delivery follow-ups and service issues are never touched.
 */
import { classifySale, cycleEnd, cycleHasEnded, commissionOnProfit } from "./commission";
import { permissionsFor, type FollowUpConfig } from "./config";
import { planCadence } from "./cadence";
import { addDays, etDate, isDateStr, nextWorkdayOnOrAfter, utcToNaiveEtSec, type DateStr } from "./dates";
import { afterChange } from "./tasks";
import {
  closeTask,
  getConfig,
  ensureBookClient,
  getLinks,
  getParty,
  insertTask,
  iso,
  logTaskEvent,
  q,
  run,
  uuid,
  type Stmt,
  type TaskRow,
} from "./store";

export type SaleKind = "SALE" | "PROMO_OPENER" | "OPENER_ONLY";

export interface RecordSaleInput {
  partyId: string;
  saleDate: DateStr;
  amount?: number | null;
  profit?: number | null;
  kind?: SaleKind;
  /** Deal closed on the very first call (70% tier). */
  firstCall?: boolean;
  /** Date the original promo order entered the company system, if it is being set/corrected now. */
  openingDate?: DateStr | null;
  products?: string | null;
  interests?: string | null;
  notes?: string | null;
  shipment?: { carrier: string; trackingLink: string; expectedDelivery?: DateStr | null; notes?: string | null } | null;
  idemKey: string;
  source?: string;
  now?: Date;
}

export interface RecordSaleResult {
  ok: boolean;
  error?: string;
  duplicate?: boolean;
  orderId?: string;
  cycleId?: string | null;
  tasksCreated?: number;
  nextAction?: { purpose: string; dueDate: DateStr } | null;
  note?: string;
}

export async function recordSale(input: RecordSaleInput): Promise<RecordSaleResult> {
  const now = input.now ?? new Date();
  const today = etDate(now);

  const dup = await q<{ id: string; cycle: string | null }>(
    `SELECT o.id, (SELECT id FROM fu_cycles WHERE order_id = o.id LIMIT 1) AS cycle FROM fu_orders o WHERE o.idem_key = ?`,
    [input.idemKey]
  );
  if (dup.length) return { ok: true, duplicate: true, orderId: dup[0].id, cycleId: dup[0].cycle };

  if (!isDateStr(input.saleDate)) return { ok: false, error: "Enter a valid sale date." };
  if (input.saleDate > today) return { ok: false, error: "A sale can’t be dated in the future." };
  if (input.openingDate && !isDateStr(input.openingDate)) return { ok: false, error: "Invalid opening date." };

  const party = await getParty(input.partyId);
  if (!party) return { ok: false, error: "Client not found." };
  const cfg = await getConfig();
  const kind: SaleKind = input.kind ?? "SALE";
  const qualifying = kind !== "OPENER_ONLY";

  // Opening date: set by a promo the owner opened, or explicitly supplied. A known date is never
  // silently overwritten by a repeat purchase — repeat sales never extend the commission window.
  let opening = party.openingDate;
  let openingSource = party.openingDateSource;
  const stmts: Stmt[] = [];
  if (input.openingDate) {
    opening = input.openingDate;
    openingSource = "manual";
  } else if (kind === "PROMO_OPENER" && !opening) {
    opening = input.saleDate;
    openingSource = "manual";
  } else if (input.firstCall && !opening) {
    opening = input.saleDate;
    openingSource = "manual";
  }

  const cls = qualifying
    ? classifySale(input.saleDate, opening, !!input.firstCall)
    : { kind: "UNKNOWN" as const, rate: null };
  const orderId = uuid();
  const ts = iso(now);
  stmts.push({
    sql: `INSERT INTO fu_orders (id, party_id, sale_date, amount, profit, qualifying, kind, first_call,
            commission_kind, commission_rate, products, notes, source, idem_key, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [orderId, party.id, input.saleDate, input.amount ?? null, input.profit ?? null, qualifying ? 1 : 0, kind,
      input.firstCall ? 1 : 0, qualifying ? cls.kind : null, cls.rate, input.products ?? null, input.notes ?? null,
      input.source ?? "manual", input.idemKey, ts],
  });

  const latest =
    qualifying && (!party.latestQualifyingSaleDate || input.saleDate > party.latestQualifyingSaleDate)
      ? input.saleDate
      : party.latestQualifyingSaleDate;
  const interests = mergeList(party.interests, input.interests);
  stmts.push({
    sql: `UPDATE parties SET opening_date = ?, opening_date_source = ?, first_call_deal = ?,
            latest_qualifying_sale_date = ?, interests = ?, pause_reason = NULL, pause_until = NULL,
            reactivation_state = CASE WHEN ? = 1 THEN 'NONE' ELSE reactivation_state END, updated_at = ?
          WHERE id = ?`,
    args: [opening, openingSource, party.firstCallDeal || (input.firstCall && qualifying) ? 1 : 0, latest, interests,
      qualifying ? 1 : 0, ts, party.id],
  });

  let cycleId: string | null = null;
  let tasksCreated = 0;
  let note: string | undefined;

  if (qualifying) {
    const active = (await q<{ id: string; start_date: string }>(
      "SELECT id, start_date FROM fu_cycles WHERE party_id = ? AND status = 'ACTIVE'", [party.id]))[0];

    if (active && active.start_date > input.saleDate) {
      note = "Older sale recorded — the newer active cycle was kept.";
    } else if (cycleHasEnded(input.saleDate, today)) {
      note = "Sale is more than 30 days old — recorded without starting a new cycle.";
    } else {
      if (active) {
        const old = await q<TaskRow>(
          "SELECT * FROM fu_tasks WHERE cycle_id = ? AND category = 'CADENCE' AND status = 'PENDING'", [active.id]);
        for (const t of old) {
          if (t.due_date < today) stmts.push(logTaskEvent(t.id, "MISSED", "Step was due and not done before the new sale", now));
          stmts.push(...closeTask(t.id, "SUPERSEDED", `New sale on ${input.saleDate} restarted the 30-day cycle`, now));
        }
        stmts.push({
          sql: `UPDATE fu_cycles SET status = 'CLOSED', close_reason = 'RESTARTED', closed_at = ? WHERE id = ?`,
          args: [ts, active.id],
        });
      }
      cycleId = uuid();
      stmts.push({
        sql: `INSERT INTO fu_cycles (id, party_id, order_id, start_date, end_date, status, created_at)
              VALUES (?,?,?,?,?, 'ACTIVE', ?)`,
        args: [cycleId, party.id, orderId, input.saleDate, cycleEnd(input.saleDate), ts],
      });
      const made = cadenceTasks(party.id, cycleId, orderId, input.saleDate, today, cfg, party, now);
      stmts.push(...made.stmts);
      tasksCreated += made.count;
    }
  }

  // Any sale Jorge makes puts the client in his book (no-op if already there).
  if (qualifying) await ensureBookClient(party.id);

  // Shipment obligations (orders always ship; the owner needs the tracking + calls).
  if (qualifying || kind === "OPENER_ONLY") {
    const links = await getLinks(party.id);
    if (input.shipment && links.bookClientId) {
      const shipId = uuid();
      const naive = utcToNaiveEtSec(now);
      stmts.push({
        sql: `INSERT INTO shipments (id, book_client_id, carrier, tracking_link, notes, sale_amount, shipped_at,
                created_at, updated_at, party_id, order_id, expected_delivery)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [shipId, links.bookClientId, input.shipment.carrier, input.shipment.trackingLink,
          input.shipment.notes ?? null, input.amount ?? null, naive, naive, naive, party.id, orderId,
          input.shipment.expectedDelivery ?? null],
      });
      if (input.amount) {
        stmts.push({
          sql: `UPDATE book_clients SET lifetime_value = lifetime_value + ?, updated_at = datetime('now') WHERE id = ?`,
          args: [input.amount, links.bookClientId],
        });
      }
      const due = nextWorkdayOnOrAfter(today, cfg);
      stmts.push(...insertTask({
        partyId: party.id, orderId, shipmentId: shipId, category: "SHIPMENT", type: "CALL",
        purpose: "Call: your order has shipped", dueDate: due, dedupeKey: `shipcall:${shipId}`,
      }, now).stmts);
      tasksCreated++;
    } else {
      stmts.push(...insertTask({
        partyId: party.id, orderId, category: "SHIPMENT", type: "TASK",
        purpose: "Enter shipment / tracking for this sale", dueDate: nextWorkdayOnOrAfter(today, cfg),
        dedupeKey: `shipinfo:${orderId}`,
      }, now).stmts);
      tasksCreated++;
    }
  }

  await run(stmts);
  await afterChange(party.id, now);

  const next = (await q<{ purpose: string; due_date: string }>(
    `SELECT purpose, due_date FROM fu_tasks WHERE party_id = ? AND status = 'PENDING' AND category IN ('CADENCE','CALLBACK','MANUAL')
     ORDER BY due_date LIMIT 1`, [party.id]))[0];
  return {
    ok: true,
    orderId,
    cycleId,
    tasksCreated,
    note,
    nextAction: next ? { purpose: next.purpose, dueDate: next.due_date } : null,
  };
}

/** Cadence task inserts for a cycle: future-dated only (never a backlog), honoring permissions. */
export function cadenceTasks(
  partyId: string,
  cycleId: string,
  orderId: string | null,
  cycleStart: DateStr,
  today: DateStr,
  cfg: FollowUpConfig,
  party: { restrictions: import("./config").Restrictions; ghost: boolean },
  now: Date
): { stmts: Stmt[]; count: number } {
  const perms = permissionsFor(party.restrictions, party.ghost, cfg);
  if (!perms.call && !perms.text) return { stmts: [], count: 0 };
  const plan = planCadence(cycleStart, cfg, cfg.cadence, perms);
  const stmts: Stmt[] = [];
  let count = 0;
  for (const step of plan) {
    if (step.dueDate < today) continue; // missed before the cycle existed — skipped, not backfilled
    const bits = [step.purpose];
    if (step.voicemail) bits.push("leave voicemail if no answer");
    if (step.text) bits.push("send text");
    if (step.differentPeriod) bits.push("try a different time of day");
    stmts.push(...insertTask({
      partyId, cycleId, orderId, category: "CADENCE", type: step.call ? "CALL" : "TEXT",
      purpose: `Day ${step.day}: ${bits.join(" · ")}`, dueDate: step.dueDate, cadenceDay: step.day,
      cadenceKey: step.key, voicemail: step.voicemail, textStep: step.text, differentPeriod: step.differentPeriod,
      dedupeKey: `cad:${cycleId}:${step.key}`,
      detail: step.mergedDays.length ? `Merged with day ${step.mergedDays.join(", ")}` : null,
    }, now).stmts);
    count++;
  }
  return { stmts, count };
}

function mergeList(a: string | null, b: string | null | undefined): string | null {
  const set = new Set([...(a ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    ...(b ?? "").split(",").map((s) => s.trim()).filter(Boolean)]);
  return set.size ? [...set].join(", ") : null;
}

export { commissionOnProfit, addDays };
