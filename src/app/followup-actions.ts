"use server";

import { revalidatePath } from "next/cache";
import { applyBackfill, dismissDuplicate, dismissReactivation, mergeParties, previewBackfill, selectForReactivation, type BackfillPreview, type BackfillResult } from "@/lib/followup/admin";
import { parseConfig, type FollowUpConfig, type Restrictions } from "@/lib/followup/config";
import { logContact } from "@/lib/followup/contacts";
import { isDateStr, zonedToUtc, ET } from "@/lib/followup/dates";
import { OUTCOMES, CHANNELS, type Channel, type Outcome } from "@/lib/followup/outcomes";
import { reconcile } from "@/lib/followup/reconcile";
import { recordSale, type SaleKind } from "@/lib/followup/sales";
import { recordDelivery, recordShipmentException, resolveShipmentException } from "@/lib/followup/shipping";
import { ensurePartyForBook, ensurePartyForClient, getConfig, getLinks, getParty, iso, resolvePartyId, run, saveConfig } from "@/lib/followup/store";
import { addManualTask, cancelTask, completeTask, rescheduleTaskTo, afterChange } from "@/lib/followup/tasks";

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

function refresh(...extra: string[]) {
  revalidatePath("/");
  revalidatePath("/queue");
  revalidatePath("/queue/exceptions");
  revalidatePath("/book");
  for (const p of extra) revalidatePath(p);
}

/** Dates and times typed in the app are Jorge's wall clock (Eastern). */
function etInstant(date: string, time: string): Date | null {
  if (!isDateStr(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  return zonedToUtc(date, time, ET);
}

export interface SalePayload {
  saleDate: string;
  amount?: number | null;
  profit?: number | null;
  kind?: SaleKind;
  firstCall?: boolean;
  openingDate?: string | null;
  products?: string | null;
  interests?: string | null;
  notes?: string | null;
  shipment?: { carrier: string; trackingLink: string; expectedDelivery?: string | null } | null;
}

export interface ContactPayload {
  partyId: string;
  channel: string;
  outcome: string;
  voicemailLeft?: boolean;
  taskId?: string | null;
  shipmentId?: string | null;
  purpose?: string | null;
  pitch?: string | null;
  objection?: string | null;
  objectionNote?: string | null;
  nextActionDate?: string | null;
  nextActionNote?: string | null;
  callbackDate?: string | null;
  callbackTime?: string | null;
  notes?: string | null;
  satisfaction?: string | null;
  sale?: SalePayload | null;
  idemKey: string;
  profilePath?: string;
}

function toSale(s: SalePayload | null | undefined) {
  if (!s) return null;
  return {
    saleDate: s.saleDate,
    amount: s.amount ?? null,
    profit: s.profit ?? null,
    kind: s.kind ?? ("SALE" as SaleKind),
    firstCall: !!s.firstCall,
    openingDate: s.openingDate || null,
    products: s.products?.trim() || null,
    interests: s.interests?.trim() || null,
    notes: s.notes?.trim() || null,
    shipment: s.shipment?.trackingLink
      ? { carrier: s.shipment.carrier || "Other", trackingLink: s.shipment.trackingLink.trim(), expectedDelivery: s.shipment.expectedDelivery || null }
      : null,
  };
}

export async function logContactAction(p: ContactPayload): Promise<ActionResult> {
  if (!(OUTCOMES as readonly string[]).includes(p.outcome) || !(CHANNELS as readonly string[]).includes(p.channel)) {
    return { ok: false, error: "Pick a channel and an outcome." };
  }
  if (!p.idemKey) return { ok: false, error: "Missing request id — reload and try again." };
  let callbackAt: Date | null = null;
  if (p.outcome === "CALLBACK_SET") {
    callbackAt = etInstant(p.callbackDate ?? "", p.callbackTime ?? "");
    if (!callbackAt) return { ok: false, error: "Pick the callback date and time." };
  }
  const r = await logContact({
    partyId: await resolvePartyId(p.partyId),
    channel: p.channel as Channel,
    outcome: p.outcome as Outcome,
    voicemailLeft: !!p.voicemailLeft,
    taskId: p.taskId || null,
    shipmentId: p.shipmentId || null,
    purpose: p.purpose || null,
    pitch: p.pitch || null,
    objection: p.objection || null,
    objectionNote: p.objectionNote || null,
    nextActionDate: p.nextActionDate || null,
    nextActionNote: p.nextActionNote || null,
    callbackAt,
    notes: p.notes || null,
    satisfaction: p.satisfaction || null,
    sale: toSale(p.sale),
    idemKey: p.idemKey,
  });
  refresh(p.profilePath ?? "");
  if (!r.ok) return { ok: false, error: r.error };
  const bits = [r.duplicate ? "Already logged." : "Logged."];
  if (r.completed) bits.push(`${r.completed} task${r.completed === 1 ? "" : "s"} completed.`);
  if (r.rescheduled) bits.push(`${r.rescheduled} rescheduled.`);
  if (r.sale?.note) bits.push(r.sale.note);
  if (r.nextAction) bits.push(`Next: ${r.nextAction}`);
  return { ok: true, message: bits.join(" ") };
}

export async function recordSaleAction(partyId: string, s: SalePayload, idemKey: string, profilePath?: string): Promise<ActionResult> {
  const sale = toSale(s);
  if (!sale) return { ok: false, error: "Enter the sale." };
  const r = await recordSale({ ...sale, partyId: await resolvePartyId(partyId), idemKey });
  refresh(profilePath ?? "");
  if (!r.ok) return { ok: false, error: r.error };
  const bits = [r.duplicate ? "That sale was already recorded." : "Sale recorded."];
  if (r.note) bits.push(r.note);
  if (r.nextAction) bits.push(`Next: ${r.nextAction.purpose} (${r.nextAction.dueDate})`);
  return { ok: true, message: bits.join(" ") };
}

// ── Tasks ─────────────────────────────────────────────────────────────────

export async function completeTaskAction(taskId: string, reason?: string): Promise<ActionResult> {
  const e = await completeTask(taskId, reason?.trim() || "Marked done", new Date());
  refresh();
  return e ? { ok: false, error: e } : { ok: true };
}

export async function cancelTaskAction(taskId: string, reason: string): Promise<ActionResult> {
  const e = await cancelTask(taskId, reason, new Date());
  refresh();
  return e ? { ok: false, error: e } : { ok: true };
}

export async function rescheduleTaskAction(taskId: string, date: string, time: string | null, reason?: string): Promise<ActionResult> {
  if (!isDateStr(date)) return { ok: false, error: "Pick a date." };
  const at = time ? etInstant(date, time) : null;
  const e = await rescheduleTaskTo(taskId, { date, at }, reason?.trim() || "Rescheduled by user", new Date());
  refresh();
  return e ? { ok: false, error: e } : { ok: true };
}

export async function addTaskAction(partyId: string, purpose: string, date: string, time: string | null, kind: "MANUAL" | "CALLBACK" | "SERVICE", idemKey: string, profilePath?: string): Promise<ActionResult> {
  if (!isDateStr(date)) return { ok: false, error: "Pick a date." };
  const at = time ? etInstant(date, time) : null;
  const e = await addManualTask(await resolvePartyId(partyId), { purpose, dueDate: date, at, category: kind }, idemKey, new Date());
  refresh(profilePath ?? "");
  return e ? { ok: false, error: e } : { ok: true, message: "Task added." };
}

// ── Shipments ─────────────────────────────────────────────────────────────

export async function recordDeliveryAction(shipmentId: string, date: string | null, profilePath?: string): Promise<ActionResult> {
  const r = await recordDelivery(shipmentId, date || null, new Date());
  refresh(profilePath ?? "");
  if (!r.ok) return { ok: false, error: r.error };
  if (r.duplicate) return { ok: true, message: "Already marked delivered — no new check-in created." };
  return {
    ok: true,
    message: r.deferred
      ? "Delivered. The check-in call is outside calling hours, so it is scheduled for the next allowed slot (still visible today)."
      : "Delivered. A check-in call is due now.",
  };
}

export async function shipmentExceptionAction(shipmentId: string, text: string, profilePath?: string): Promise<ActionResult> {
  const e = await recordShipmentException(shipmentId, text);
  refresh(profilePath ?? "");
  return e ? { ok: false, error: e } : { ok: true, message: "Issue logged." };
}

export async function resolveExceptionAction(shipmentId: string, resolution: string, profilePath?: string): Promise<ActionResult> {
  const e = await resolveShipmentException(shipmentId, resolution);
  refresh(profilePath ?? "");
  return e ? { ok: false, error: e } : { ok: true, message: "Issue resolved." };
}

// ── Client follow-up profile ──────────────────────────────────────────────

export interface PartyEdit {
  openingDate?: string | null;
  timezone?: string | null;
  interests?: string | null;
  restrictions?: Restrictions;
  pauseReason?: string | null;
  pauseUntil?: string | null;
}

export async function updatePartyAction(partyId: string, e: PartyEdit, profilePath?: string): Promise<ActionResult> {
  const party = await getParty(partyId);
  if (!party) return { ok: false, error: "Client not found." };
  if (e.openingDate && !isDateStr(e.openingDate)) return { ok: false, error: "Opening date is invalid." };
  if (e.timezone) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: e.timezone }); } catch { return { ok: false, error: "Unknown time zone." }; }
  }
  if (e.pauseReason === "" ) e.pauseReason = null;
  const now = new Date();
  await run([{
    sql: `UPDATE parties SET opening_date = ?, opening_date_source = ?, timezone = ?, timezone_source = ?, interests = ?,
            restrictions = ?, pause_reason = ?, pause_until = ?, updated_at = ? WHERE id = ?`,
    args: [
      e.openingDate !== undefined ? e.openingDate || null : party.openingDate,
      e.openingDate !== undefined ? (e.openingDate ? "manual" : null) : party.openingDateSource,
      e.timezone !== undefined ? e.timezone || null : party.timezone,
      e.timezone !== undefined ? (e.timezone ? "manual" : null) : party.timezoneSource,
      e.interests !== undefined ? e.interests?.trim() || null : party.interests,
      JSON.stringify(e.restrictions ?? party.restrictions),
      e.pauseReason !== undefined ? e.pauseReason : party.pauseReason,
      e.pauseUntil !== undefined ? e.pauseUntil || null : party.pauseUntil,
      iso(now), party.id,
    ],
  }]);
  await reconcile(now);
  await afterChange(party.id, now);
  refresh(profilePath ?? "");
  return { ok: true, message: "Saved." };
}

// ── Settings / admin ──────────────────────────────────────────────────────

export async function saveConfigAction(raw: FollowUpConfig): Promise<ActionResult> {
  const cfg = parseConfig(JSON.stringify(raw));
  await saveConfig(cfg);
  revalidatePath("/settings/follow-up");
  refresh();
  return { ok: true, message: "Follow-up rules saved. They apply to cycles started from now on." };
}

export async function previewBackfillAction(): Promise<BackfillPreview> {
  return previewBackfill(new Date());
}

export async function applyBackfillAction(): Promise<BackfillResult> {
  const r = await applyBackfill(new Date());
  refresh("/settings/follow-up", "/duplicates", "/reactivate");
  return r;
}

export async function mergeAction(keepId: string, mergeId: string): Promise<ActionResult & { conflicts?: string[] }> {
  const r = await mergeParties(keepId, mergeId, new Date());
  revalidatePath("/duplicates");
  refresh();
  return r.ok ? { ok: true, conflicts: r.conflicts, message: "Merged. Nothing was deleted — all orders, contacts and tasks moved to the kept client." } : { ok: false, error: r.error };
}

export async function dismissDuplicateAction(a: string, b: string): Promise<ActionResult> {
  await dismissDuplicate(a, b);
  revalidatePath("/duplicates");
  return { ok: true };
}

export async function selectReactivationAction(ids: string[]): Promise<ActionResult> {
  const n = await selectForReactivation(ids, new Date());
  revalidatePath("/reactivate");
  refresh();
  return { ok: true, message: `${n} client${n === 1 ? "" : "s"} added to the reactivation queue.` };
}

export async function dismissReactivationAction(ids: string[]): Promise<ActionResult> {
  await dismissReactivation(ids, new Date());
  revalidatePath("/reactivate");
  return { ok: true };
}

/** Finds (or lazily creates) the canonical client for a legacy 50%-list / book record. */
export async function ensurePartyAction(kind: "client" | "book", id: string): Promise<{ partyId: string; name: string; hasBook: boolean; openingKnown: boolean } | null> {
  const partyId = kind === "client" ? await ensurePartyForClient(id) : await ensurePartyForBook(id);
  if (!partyId) return null;
  const p = await getParty(partyId);
  if (!p) return null;
  const links = await getLinks(p.id);
  return { partyId: p.id, name: p.displayName, hasBook: !!links.bookClientId, openingKnown: !!p.openingDate };
}

export async function loadConfigAction(): Promise<FollowUpConfig> {
  return getConfig();
}
