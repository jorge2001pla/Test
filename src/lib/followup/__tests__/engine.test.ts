import { beforeAll, describe, expect, it } from "vitest";
import db, { ready } from "@/lib/db";
import { ensurePartyForBook, ensurePartyForClient, getParty, q } from "../store";
import { recordSale } from "../sales";
import { logContact } from "../contacts";
import { recordDelivery, onShipmentCreated } from "../shipping";
import { reconcile } from "../reconcile";
import { getDailyQueue, getExceptions } from "../queue";
import { addManualTask } from "../tasks";

// Wed 2026-10-07 11:00 ET
const NOW = new Date("2026-10-07T15:00:00Z");
const at = (s: string) => new Date(s);
let n = 0;
const key = () => `k${++n}`;

async function book(name: string, phone = "305-555-0100"): Promise<{ bookId: string; partyId: string }> {
  await ready();
  const id = `b${++n}`;
  await db.execute({ sql: "INSERT INTO book_clients (id, first_name, phone, source) VALUES (?,?,?, 'manual')", args: [id, name, phone] });
  const partyId = (await ensurePartyForBook(id))!;
  return { bookId: id, partyId };
}
const pending = (partyId: string, cat?: string) =>
  q<{ id: string; category: string; due_date: string; purpose: string; status: string }>(
    `SELECT * FROM fu_tasks WHERE party_id = ? AND status = 'PENDING' ${cat ? "AND category = '" + cat + "'" : ""} ORDER BY due_date`,
    [partyId]
  );

beforeAll(async () => {
  await ready();
});

describe("record sale", () => {
  it("starts a 30-day cycle with future cadence steps and a shipment obligation", async () => {
    const { partyId } = await book("Sale One");
    const r = await recordSale({ partyId, saleDate: "2026-10-07", amount: 500, kind: "PROMO_OPENER", idemKey: key(), now: NOW });
    expect(r.ok).toBe(true);
    const cyc = await q<{ start_date: string; end_date: string }>("SELECT * FROM fu_cycles WHERE party_id = ? AND status='ACTIVE'", [partyId]);
    expect(cyc[0].start_date).toBe("2026-10-07");
    expect(cyc[0].end_date).toBe("2026-11-05");
    expect((await pending(partyId, "CADENCE")).length).toBeGreaterThanOrEqual(9);
    expect((await pending(partyId, "SHIPMENT")).length).toBe(1);
    expect((await getParty(partyId))!.openingDate).toBe("2026-10-07");
  });

  it("is idempotent: the same request twice creates one order / cycle / set of tasks", async () => {
    const { partyId } = await book("Idem");
    const k = key();
    const a = await recordSale({ partyId, saleDate: "2026-10-07", amount: 100, idemKey: k, now: NOW });
    const before = (await pending(partyId)).length;
    const b = await recordSale({ partyId, saleDate: "2026-10-07", amount: 100, idemKey: k, now: NOW });
    expect(b.duplicate).toBe(true);
    expect(b.orderId).toBe(a.orderId);
    expect((await pending(partyId)).length).toBe(before);
    expect((await q("SELECT 1 FROM fu_orders WHERE party_id = ?", [partyId])).length).toBe(1);
  });

  it("repeat sale resets the follow-up cycle but keeps the original commission window", async () => {
    const { partyId } = await book("Repeat");
    await recordSale({ partyId, saleDate: "2026-10-01", kind: "PROMO_OPENER", idemKey: key(), now: at("2026-10-01T15:00:00Z") });
    await recordSale({ partyId, saleDate: "2026-10-07", amount: 900, idemKey: key(), now: NOW });
    const p = await getParty(partyId);
    expect(p!.openingDate).toBe("2026-10-01");
    expect(p!.latestQualifyingSaleDate).toBe("2026-10-07");
    const active = await q<{ start_date: string }>("SELECT start_date FROM fu_cycles WHERE party_id = ? AND status='ACTIVE'", [partyId]);
    expect(active).toHaveLength(1);
    expect(active[0].start_date).toBe("2026-10-07");
    const closed = await q<{ close_reason: string }>("SELECT close_reason FROM fu_cycles WHERE party_id = ? AND status='CLOSED'", [partyId]);
    expect(closed[0].close_reason).toBe("RESTARTED");
    const order = await q<{ commission_kind: string }>("SELECT commission_kind FROM fu_orders WHERE party_id = ? AND sale_date = '2026-10-07'", [partyId]);
    expect(order[0].commission_kind).toBe("IN_WINDOW");
    expect((await pending(partyId, "CADENCE")).length).toBeLessThanOrEqual(10);
  });

  it("preserves promised callbacks, service issues and shipment obligations across a new sale", async () => {
    const { partyId } = await book("Preserve");
    await recordSale({ partyId, saleDate: "2026-10-01", idemKey: key(), now: at("2026-10-01T15:00:00Z") });
    await logContact({ partyId, channel: "DIALER_CALL", outcome: "CALLBACK_SET", callbackAt: at("2026-10-20T18:00:00Z"), idemKey: key(), now: at("2026-10-02T15:00:00Z") });
    await addManualTask(partyId, { purpose: "Resolve damaged slab", dueDate: "2026-10-06", category: "SERVICE" }, key(), NOW);
    await recordSale({ partyId, saleDate: "2026-10-07", amount: 300, idemKey: key(), now: NOW });
    expect((await pending(partyId, "CALLBACK")).length).toBe(1);
    expect((await pending(partyId, "SERVICE")).length).toBe(1);
    expect((await pending(partyId, "SHIPMENT")).length).toBeGreaterThanOrEqual(1);
  });

  it("non-qualifying opener-only $19.95 sale starts no cycle", async () => {
    const { partyId } = await book("OpenerOnly");
    await recordSale({ partyId, saleDate: "2026-10-07", amount: 19.95, kind: "OPENER_ONLY", idemKey: key(), now: NOW });
    expect(await q("SELECT 1 FROM fu_cycles WHERE party_id = ?", [partyId])).toHaveLength(0);
    expect((await pending(partyId, "CADENCE")).length).toBe(0);
  });
});

describe("outcomes generate next actions", () => {
  it("no answer logs an attempt (not a conversation) and leaves a next step", async () => {
    const { partyId, bookId } = await book("NoAnswer");
    await recordSale({ partyId, saleDate: "2026-10-05", idemKey: key(), now: at("2026-10-05T15:00:00Z") });
    const r = await logContact({ partyId, channel: "DIALER_CALL", outcome: "NO_ANSWER", voicemailLeft: true, idemKey: key(), now: NOW });
    expect(r.ok).toBe(true);
    expect(r.nextAction).toBeTruthy();
    const p = await getParty(partyId);
    expect(p!.lastAttemptAt).toBeTruthy();
    expect(p!.lastConversationAt).toBeNull();
    expect((await q("SELECT 1 FROM book_call_log_entries WHERE book_client_id = ?", [bookId])).length).toBe(1);
  });

  it("declined requires an objection and a next action date, and produces a task", async () => {
    const { partyId } = await book("Declined");
    expect((await logContact({ partyId, channel: "DIALER_CALL", outcome: "DECLINED", idemKey: key(), now: NOW })).ok).toBe(false);
    expect((await logContact({ partyId, channel: "DIALER_CALL", outcome: "DECLINED", objection: "NO_FURTHER_CONTACT", nextActionDate: "2026-10-20", idemKey: key(), now: NOW })).ok).toBe(false);
    const ok = await logContact({ partyId, channel: "DIALER_CALL", outcome: "DECLINED", objection: "PRICE_BUDGET", nextActionDate: "2026-10-20", idemKey: key(), now: NOW });
    expect(ok.ok).toBe(true);
    const t = await pending(partyId, "MANUAL");
    expect(t).toHaveLength(1);
    expect(t[0].due_date).toBe("2026-10-20");
    const p = await getParty(partyId);
    expect(p!.ghost).toBe(false);
    expect(p!.restrictions.doNotContact).toBeUndefined();
  });

  it("logging the same contact twice does not duplicate anything", async () => {
    const { partyId } = await book("DupContact");
    const k = key();
    await logContact({ partyId, channel: "DIALER_CALL", outcome: "CALLBACK_SET", callbackAt: at("2026-10-09T18:00:00Z"), idemKey: k, now: NOW });
    await logContact({ partyId, channel: "DIALER_CALL", outcome: "CALLBACK_SET", callbackAt: at("2026-10-09T18:00:00Z"), idemKey: k, now: NOW });
    expect(await q("SELECT 1 FROM fu_contacts WHERE party_id = ?", [partyId])).toHaveLength(1);
    expect(await pending(partyId, "CALLBACK")).toHaveLength(1);
  });

  it("an unanswered callback records an attempt and reschedules instead of completing", async () => {
    const { partyId } = await book("CbMiss");
    await logContact({ partyId, channel: "DIALER_CALL", outcome: "CALLBACK_SET", callbackAt: at("2026-10-07T15:30:00Z"), idemKey: key(), now: NOW });
    await logContact({ partyId, channel: "DIALER_CALL", outcome: "NO_ANSWER", idemKey: key(), now: at("2026-10-07T15:40:00Z") });
    const cb = await pending(partyId, "CALLBACK");
    expect(cb).toHaveLength(1);
    expect(cb[0].due_date > "2026-10-07").toBe(true);
  });
});

describe("delivery workflow", () => {
  async function shippedClient(name: string) {
    const { partyId, bookId } = await book(name);
    await recordSale({ partyId, saleDate: "2026-10-05", amount: 1000, idemKey: key(), now: at("2026-10-05T15:00:00Z") });
    const sid = `s${++n}`;
    await db.execute({ sql: "INSERT INTO shipments (id, book_client_id, carrier, tracking_link, sale_amount) VALUES (?,?,?,?,?)", args: [sid, bookId, "USPS", "http://t", 1000] });
    await onShipmentCreated(sid, at("2026-10-05T16:00:00Z"));
    return { partyId, sid };
  }

  it("delivery creates a same-day check-in; an unanswered call does not complete it", async () => {
    const { partyId, sid } = await shippedClient("Deliv");
    expect((await recordDelivery(sid, "2026-10-07", NOW)).ok).toBe(true);
    let t = await pending(partyId, "DELIVERY");
    expect(t).toHaveLength(1);
    expect(t[0].due_date).toBe("2026-10-07");
    await logContact({ partyId, channel: "DIALER_CALL", outcome: "NO_ANSWER", shipmentId: sid, idemKey: key(), now: NOW });
    t = await pending(partyId, "DELIVERY");
    expect(t).toHaveLength(1);
    expect(t[0].due_date > "2026-10-07").toBe(true);
    await recordDelivery(sid, "2026-10-07", NOW); // re-marking never adds another
    expect(await pending(partyId, "DELIVERY")).toHaveLength(1);
    await logContact({ partyId, channel: "DIALER_CALL", outcome: "DELIVERY_CONFIRMED", shipmentId: sid, idemKey: key(), now: at("2026-10-08T15:00:00Z") });
    expect(await pending(partyId, "DELIVERY")).toHaveLength(0);
    const s = await q<{ receipt_confirmed_at: string | null }>("SELECT receipt_confirmed_at FROM shipments WHERE id = ?", [sid]);
    expect(s[0].receipt_confirmed_at).toBeTruthy();
  });

  it("delivery + cadence due the same day show as ONE row and one call satisfies both", async () => {
    const { partyId, sid } = await shippedClient("Stack");
    await recordDelivery(sid, "2026-10-07", NOW);
    const all = await getDailyQueue(NOW, { pageSize: 500 });
    const rows = all.sections.flatMap((s) => s.rows).filter((r) => r.partyId === partyId);
    expect(rows).toHaveLength(1);
    expect(rows[0].section).toBe(2);
    expect(rows[0].tasks.length).toBeGreaterThan(1);
    await logContact({ partyId, channel: "DIALER_CALL", outcome: "NO_ANSWER", idemKey: key(), now: NOW });
    const left = await q("SELECT 1 FROM fu_tasks WHERE party_id = ? AND status='PENDING' AND due_date <= '2026-10-07' AND category IN ('CADENCE','DELIVERY')", [partyId]);
    expect(left).toHaveLength(0);
  });
});

describe("reconcile", () => {
  it("missed steps collapse — no burst of catch-up calls", async () => {
    const { partyId } = await book("Missed");
    await recordSale({ partyId, saleDate: "2026-09-20", idemKey: key(), now: at("2026-09-20T15:00:00Z") });
    await reconcile(NOW);
    const due = await q("SELECT id FROM fu_tasks WHERE party_id = ? AND category='CADENCE' AND status='PENDING' AND due_date <= '2026-10-07'", [partyId]);
    expect(due.length).toBeLessThanOrEqual(1);
    const missed = await q("SELECT 1 FROM fu_task_events e JOIN fu_tasks t ON t.id=e.task_id WHERE t.party_id=? AND e.event='MISSED'", [partyId]);
    expect(missed.length).toBeGreaterThan(0);
    const ex = await getExceptions(NOW);
    expect(ex.missedSteps.some((m) => m.partyId === partyId)).toBe(true);
  });

  it("GHOST cancels outreach, blocks reactivation, but keeps service issues", async () => {
    const { partyId } = await book("Ghosty");
    await recordSale({ partyId, saleDate: "2026-10-05", idemKey: key(), now: at("2026-10-05T15:00:00Z") });
    await addManualTask(partyId, { purpose: "Replace missing coin", dueDate: "2026-10-06", category: "SERVICE" }, key(), NOW);
    await logContact({ partyId, channel: "DIALER_CALL", outcome: "GHOST", idemKey: key(), now: NOW });
    expect(await pending(partyId, "CADENCE")).toHaveLength(0);
    expect(await pending(partyId, "SERVICE")).toHaveLength(1);
    const p = await getParty(partyId);
    expect(p!.ghost).toBe(true);
    expect(p!.reactivationState).toBe("NONE");
    await reconcile(new Date("2026-12-30T15:00:00Z"));
    expect((await getParty(partyId))!.reactivationState).toBe("NONE");
  });

  it("cycle closure preserves service tasks and future callbacks, and flags reactivation eligibility", async () => {
    const { partyId } = await book("Closer");
    await recordSale({ partyId, saleDate: "2026-09-01", idemKey: key(), now: at("2026-09-01T15:00:00Z") });
    await logContact({ partyId, channel: "DIALER_CALL", outcome: "CALLBACK_SET", callbackAt: at("2026-10-30T18:00:00Z"), idemKey: key(), now: at("2026-09-02T15:00:00Z") });
    await addManualTask(partyId, { purpose: "Resolve billing question", dueDate: "2026-09-30", category: "SERVICE" }, key(), at("2026-09-30T15:00:00Z"));
    await reconcile(NOW);
    const cyc = await q<{ status: string; close_reason: string }>("SELECT status, close_reason FROM fu_cycles WHERE party_id = ?", [partyId]);
    expect(cyc[0].status).toBe("CLOSED");
    expect(["NO_RESPONSE", "CLOSED_MISSED_STEPS", "COMPLETED"]).toContain(cyc[0].close_reason);
    expect(await pending(partyId, "CADENCE")).toHaveLength(0);
    expect(await pending(partyId, "CALLBACK")).toHaveLength(1);
    expect(await pending(partyId, "SERVICE")).toHaveLength(1);
    expect((await getParty(partyId))!.reactivationState).toBe("ELIGIBLE");
  });
});

describe("queue", () => {
  it("shows more than ten due clients with accurate counts and pagination", async () => {
    for (let i = 0; i < 14; i++) {
      const { partyId } = await book(`Bulk ${i}`);
      await addManualTask(partyId, { purpose: "Call back", dueDate: "2026-10-06" }, key(), NOW);
    }
    const all = await getDailyQueue(NOW, { pageSize: 500 });
    expect(all.sections.flatMap((s) => s.rows).filter((r) => r.name.startsWith("Bulk")).length).toBe(14);
    const p1 = await getDailyQueue(NOW, { page: 1, pageSize: 10 });
    expect(p1.pages).toBeGreaterThan(1);
    expect(p1.totalClients).toBe(all.totalClients);
    const p2 = await getDailyQueue(NOW, { page: 2, pageSize: 10 });
    expect(p2.sections.flatMap((s) => s.rows).length).toBeGreaterThan(0);
  });
});

describe("migration safety", () => {
  it("legacy history survives; an explicit book link shares one canonical person", async () => {
    await ready();
    await db.execute("INSERT INTO book_clients (id, first_name, phone) VALUES ('lb1','Link','212-555-0000')");
    await db.execute("INSERT INTO clients (id, name, phone, first_sale_date, status, book_client_id) VALUES ('lc1','Link Person','212-555-0000','2026-10-01','NO_DISPO','lb1')");
    await db.execute("INSERT INTO call_log_entries (id, client_id, timestamp, note_text, resulting_status) VALUES ('x1','lc1','2026-10-02T10:00:00','old note','NO_DISPO')");
    const a = await ensurePartyForClient("lc1");
    const b = await ensurePartyForBook("lb1");
    expect(a).toBe(b);
    expect((await q("SELECT 1 FROM call_log_entries WHERE client_id='lc1'")).length).toBe(1);
    expect((await getParty(a!))!.openingDate).toBe("2026-10-01");
  });
});

describe("tracking added after the sale", () => {
  it("attaches to the existing order, completes the enter-shipment task and queues the shipped call, once", async () => {
    const { partyId, bookId } = await book("LateTracking");
    const sale = await recordSale({ partyId, saleDate: "2026-10-06", amount: 800, idemKey: key(), now: at("2026-10-06T15:00:00Z") });
    expect((await pending(partyId, "SHIPMENT")).map((t) => t.purpose)).toEqual(["Enter shipment / tracking for this sale"]);
    const { addTrackingToOrder } = await import("../shipping");
    const r = await addTrackingToOrder(sale.orderId!, { carrier: "USPS", trackingLink: "https://t/1" }, NOW);
    expect(r.ok).toBe(true);
    await addTrackingToOrder(sale.orderId!, { carrier: "USPS", trackingLink: "https://t/1" }, NOW); // double submit
    expect((await q("SELECT 1 FROM fu_orders WHERE party_id = ?", [partyId])).length).toBe(1);
    expect((await q("SELECT 1 FROM shipments WHERE order_id = ?", [sale.orderId!])).length).toBe(1);
    const t = await pending(partyId, "SHIPMENT");
    expect(t.map((x) => x.purpose)).toEqual(["Call: your order has shipped"]);
    const ltv = await q<{ lifetime_value: number }>("SELECT lifetime_value FROM book_clients WHERE id = ?", [bookId]);
    expect(Number(ltv[0].lifetime_value)).toBe(800);
  });
});
