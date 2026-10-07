/**
 * Shipment / delivery workflow. Estimated delivery is never treated as confirmed; recording a
 * delivery creates a same-day check-in obligation that only a client-confirmed receipt completes.
 */
import { etDate, isDateStr, isWithinCallingHours, nextAllowedSlot, nextWorkdayOnOrAfter, utcToNaiveEtSec, type DateStr } from "./dates";
import { recordSale } from "./sales";
import { uuid } from "./store";
import { afterChange } from "./tasks";
import {
  closeTask,
  ensurePartyForBook,
  getConfig,
  getParty,
  insertTask,
  iso,
  partyZone,
  q,
  run,
  type Stmt,
} from "./store";

interface ShipRow {
  id: string;
  book_client_id: string;
  party_id: string | null;
  order_id: string | null;
  sale_amount: number | null;
  delivered_at: string | null;
  delivered_date: string | null;
}

/** Called after the legacy shipments form creates a shipment: tie it to the canonical person and
 * its order (creating the order for a priced shipment that has none), and queue the shipped call. */
export async function onShipmentCreated(shipmentId: string, now: Date = new Date()): Promise<void> {
  const s = (await q<ShipRow>("SELECT * FROM shipments WHERE id = ?", [shipmentId]))[0];
  if (!s) return;
  const partyId = s.party_id ?? (await ensurePartyForBook(s.book_client_id));
  if (!partyId) return;
  const cfg = await getConfig();
  const today = etDate(now);
  const stmts: Stmt[] = [{ sql: "UPDATE shipments SET party_id = ? WHERE id = ? AND party_id IS NULL", args: [partyId, shipmentId] }];

  let orderId = s.order_id;
  if (!orderId) {
    // Attach to the newest unshipped order from the last 14 days (same amount when priced).
    const open = await q<{ id: string }>(
      `SELECT o.id FROM fu_orders o WHERE o.party_id = ? AND o.qualifying = 1 AND o.sale_date >= date(?, '-30 day')
         AND NOT EXISTS (SELECT 1 FROM shipments sh WHERE sh.order_id = o.id)
       ORDER BY (o.amount IS NOT NULL AND o.amount = ?) DESC, o.sale_date DESC LIMIT 1`,
      [partyId, today, s.sale_amount ?? -1]
    );
    if (open.length) orderId = open[0].id;
  }
  if (orderId) {
    stmts.push({ sql: "UPDATE shipments SET order_id = ? WHERE id = ?", args: [orderId, shipmentId] });
    // The "enter shipment" obligation for that order is now met.
    const info = await q<{ id: string }>("SELECT id FROM fu_tasks WHERE dedupe_key = ? AND status = 'PENDING'", [`shipinfo:${orderId}`]);
    for (const t of info) stmts.push(...closeTask(t.id, "COMPLETED", "Shipment entered", now));
  }
  await run(stmts);

  // A priced shipment with no recorded sale IS the sale (this is how the book has always worked).
  if (!orderId && s.sale_amount) {
    const r = await recordSale({
      partyId, saleDate: today, amount: s.sale_amount, kind: "SALE", idemKey: `ship-order:${shipmentId}`,
      source: "shipment", now,
    });
    if (r.orderId) {
      await run([
        { sql: "UPDATE shipments SET order_id = ? WHERE id = ?", args: [r.orderId, shipmentId] },
        ...(await q<{ id: string }>("SELECT id FROM fu_tasks WHERE dedupe_key = ? AND status = 'PENDING'", [`shipinfo:${r.orderId}`]))
          .flatMap((t) => closeTask(t.id, "COMPLETED", "Shipment entered", now)),
      ]);
      orderId = r.orderId;
    }
  }

  await run(insertTask({
    partyId, orderId, shipmentId, category: "SHIPMENT", type: "CALL", purpose: "Call: your order has shipped",
    dueDate: nextWorkdayOnOrAfter(today, cfg), dedupeKey: `shipcall:${shipmentId}`,
  }, now).stmts);
  await afterChange(partyId, now);
}

export interface DeliveryResult {
  ok: boolean;
  error?: string;
  duplicate?: boolean;
  /** When the check-in is due — now if inside calling hours, else the next allowed slot. */
  dueAt?: string;
  deferred?: boolean;
}

/** Manual delivery update. `deliveredDate` defaults to today (ET). */
export async function recordDelivery(shipmentId: string, deliveredDate?: DateStr | null, now: Date = new Date()): Promise<DeliveryResult> {
  const s = (await q<ShipRow>("SELECT * FROM shipments WHERE id = ?", [shipmentId]))[0];
  if (!s) return { ok: false, error: "Shipment not found." };
  const today = etDate(now);
  const date = deliveredDate || today;
  if (!isDateStr(date) || date > today) return { ok: false, error: "Delivery date can’t be in the future." };
  const partyId = s.party_id ?? (await ensurePartyForBook(s.book_client_id));
  if (!partyId) return { ok: false, error: "Client not found." };
  const party = await getParty(partyId);
  if (!party) return { ok: false, error: "Client not found." };
  const cfg = await getConfig();
  const { tz } = partyZone(party, cfg);

  const key = `delivery:${shipmentId}`;
  const existing = await q("SELECT 1 FROM fu_tasks WHERE dedupe_key = ? AND status = 'PENDING' LIMIT 1", [key]);
  const already = !!s.delivered_date || !!s.delivered_at;
  if (already) {
    // Re-marking never spawns another check-in; just report the existing state.
    return { ok: true, duplicate: true };
  }

  // Same-day check-in: due now when inside the client's calling hours, otherwise it stays
  // visible today and its exact time moves to the next allowed slot.
  const inHours = isWithinCallingHours(now, tz, cfg);
  const dueAt = inHours ? now : nextAllowedSlot(now, tz, cfg);
  const naive = utcToNaiveEtSec(now);
  const stmts: Stmt[] = [
    { sql: "UPDATE shipments SET delivered_at = ?, delivered_date = ?, party_id = COALESCE(party_id, ?), updated_at = ? WHERE id = ?",
      args: [naive, date, partyId, naive, shipmentId] },
    ...(existing.length ? [] : insertTask({
      partyId, orderId: s.order_id, shipmentId, category: "DELIVERY", type: "CALL",
      purpose: "Delivery check-in: confirm receipt & satisfaction",
      dueDate: etDate(dueAt) < today ? today : etDate(dueAt), dueAt: iso(dueAt), dedupeKey: key,
      detail: inHours ? null : "Outside calling hours — scheduled for the next allowed slot",
    }, now).stmts),
  ];
  await run(stmts);
  await afterChange(partyId, now);
  return { ok: true, dueAt: iso(dueAt), deferred: !inHours };
}

/** Open shipment problem / service issue — tracked until resolved, never auto-cancelled. */
export async function recordShipmentException(shipmentId: string, text: string, now: Date = new Date()): Promise<string | null> {
  if (!text.trim()) return "Describe the issue.";
  const s = (await q<ShipRow>("SELECT * FROM shipments WHERE id = ?", [shipmentId]))[0];
  if (!s) return "Shipment not found.";
  const partyId = s.party_id ?? (await ensurePartyForBook(s.book_client_id));
  if (!partyId) return "Client not found.";
  await run([
    { sql: "UPDATE shipments SET exception = ?, exception_at = ?, exception_resolved_at = NULL, party_id = COALESCE(party_id, ?) WHERE id = ?",
      args: [text.trim(), iso(now), partyId, shipmentId] },
    ...insertTask({
      partyId, orderId: s.order_id, shipmentId, category: "SERVICE", type: "TASK",
      purpose: `Shipment issue: ${text.trim().slice(0, 140)}`, dueDate: etDate(now), dedupeKey: `svc:${shipmentId}`,
    }, now).stmts,
  ]);
  await afterChange(partyId, now);
  return null;
}

export async function resolveShipmentException(shipmentId: string, resolution: string, now: Date = new Date()): Promise<string | null> {
  const s = (await q<ShipRow>("SELECT * FROM shipments WHERE id = ?", [shipmentId]))[0];
  if (!s) return "Shipment not found.";
  const tasks = await q<{ id: string; party_id: string }>("SELECT id, party_id FROM fu_tasks WHERE dedupe_key = ? AND status = 'PENDING'", [`svc:${shipmentId}`]);
  await run([
    { sql: "UPDATE shipments SET exception_resolved_at = ? WHERE id = ?", args: [iso(now), shipmentId] },
    ...tasks.flatMap((t) => closeTask(t.id, "COMPLETED", resolution.trim() || "Resolved", now)),
  ]);
  if (s.party_id) await afterChange(s.party_id, now);
  return null;
}

export async function updateShipmentExpected(shipmentId: string, expected: DateStr | null): Promise<string | null> {
  if (expected && !isDateStr(expected)) return "Invalid date.";
  await run([{ sql: "UPDATE shipments SET expected_delivery = ? WHERE id = ?", args: [expected, shipmentId] }]);
  return null;
}

export interface TrackingInput {
  carrier: string;
  trackingLink: string;
  expectedDelivery?: DateStr | null;
  notes?: string | null;
}

/** Adds tracking to a sale that was recorded earlier (tracking usually exists 1–2 days later).
 * Attaches to the EXISTING order — never creates a second order — completes the "enter
 * shipment" task and queues the "shipped" call. Idempotent per order. */
export async function addTrackingToOrder(orderId: string, t: TrackingInput, now: Date = new Date()): Promise<{ ok: boolean; error?: string }> {
  if (!t.trackingLink.trim()) return { ok: false, error: "Paste the tracking link." };
  if (t.expectedDelivery && !isDateStr(t.expectedDelivery)) return { ok: false, error: "Invalid expected delivery date." };
  const o = (await q<{ id: string; party_id: string; amount: number | null }>("SELECT id, party_id, amount FROM fu_orders WHERE id = ?", [orderId]))[0];
  if (!o) return { ok: false, error: "Sale not found." };
  const already = await q("SELECT 1 FROM shipments WHERE order_id = ? AND tracking_link = ? LIMIT 1", [orderId, t.trackingLink.trim()]);
  if (already.length) return { ok: true };
  const book = (await q<{ id: string }>("SELECT id FROM book_clients WHERE party_id = ? ORDER BY created_at LIMIT 1", [o.party_id]))[0];
  if (!book) return { ok: false, error: "Add this client to your book first (button on their profile), then add the tracking." };
  const cfg = await getConfig();
  const today = etDate(now);
  const sid = uuid();
  const naive = utcToNaiveEtSec(now);
  const stmts: Stmt[] = [
    {
      sql: `INSERT INTO shipments (id, book_client_id, carrier, tracking_link, notes, sale_amount, shipped_at, created_at, updated_at,
              party_id, order_id, expected_delivery) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [sid, book.id, t.carrier || "Other", t.trackingLink.trim(), t.notes ?? null, o.amount, naive, naive, naive, o.party_id, orderId, t.expectedDelivery ?? null],
    },
  ];
  if (o.amount) {
    stmts.push({ sql: "UPDATE book_clients SET lifetime_value = lifetime_value + ?, updated_at = datetime('now') WHERE id = ?", args: [o.amount, book.id] });
  }
  for (const task of await q<{ id: string }>("SELECT id FROM fu_tasks WHERE dedupe_key = ? AND status = 'PENDING'", [`shipinfo:${orderId}`])) {
    stmts.push(...closeTask(task.id, "COMPLETED", "Tracking added", now));
  }
  stmts.push(...insertTask({
    partyId: o.party_id, orderId, shipmentId: sid, category: "SHIPMENT", type: "CALL", purpose: "Call: your order has shipped",
    dueDate: nextWorkdayOnOrAfter(today, cfg), dedupeKey: `shipcall:${sid}`,
  }, now).stmts);
  await run(stmts);
  await afterChange(o.party_id, now);
  return { ok: true };
}
