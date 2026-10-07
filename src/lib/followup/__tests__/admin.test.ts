import { beforeAll, describe, expect, it } from "vitest";
import db, { ready } from "@/lib/db";
import { ensurePartyForBook, getParty, q } from "../store";
import { recordSale } from "../sales";
import { logContact } from "../contacts";
import { reconcile } from "../reconcile";
import { getDailyQueue } from "../queue";
import { applyBackfill, findDuplicates, listReactivationPool, mergeParties, previewBackfill, selectForReactivation } from "../admin";

const NOW = new Date("2026-10-07T15:00:00Z");
let n = 100;
const key = () => `a${++n}`;

async function book(first: string, phone: string, email: string | null = null) {
  await ready();
  const id = `ab${++n}`;
  await db.execute({ sql: "INSERT INTO book_clients (id, first_name, phone, email, source) VALUES (?,?,?,?, 'manual')", args: [id, first, phone, email] });
  return { id, partyId: (await ensurePartyForBook(id))! };
}

beforeAll(async () => {
  await ready();
});

describe("duplicates & merge", () => {
  it("never flags a pair by name alone; flags a shared phone", async () => {
    const a = await book("Same Name", "786-555-1111");
    const b = await book("Same Name", "786-555-2222");
    const c = await book("Different", "786-555-1111");
    const pairs = await findDuplicates();
    const has = (x: string, y: string) => pairs.some((p) => [p.a.partyId, p.b.partyId].sort().join() === [x, y].sort().join());
    expect(has(a.partyId, b.partyId)).toBe(false);
    expect(has(a.partyId, c.partyId)).toBe(true);
  });

  it("merge preserves orders/contacts/ids, closes the older duplicate cycle and is idempotent", async () => {
    const keep = await book("Keep", "954-555-0001");
    const gone = await book("Gone", "954-555-0001");
    await recordSale({ partyId: keep.partyId, saleDate: "2026-10-01", amount: 100, idemKey: key(), now: new Date("2026-10-01T15:00:00Z") });
    await recordSale({ partyId: gone.partyId, saleDate: "2026-10-05", amount: 200, idemKey: key(), now: new Date("2026-10-05T15:00:00Z") });
    await logContact({ partyId: gone.partyId, channel: "DIALER_CALL", outcome: "NO_ANSWER", idemKey: key(), now: NOW });
    const r = await mergeParties(keep.partyId, gone.partyId, NOW);
    expect(r.ok).toBe(true);
    expect(r.conflicts.length).toBeGreaterThan(0);
    expect((await q("SELECT 1 FROM fu_orders WHERE party_id = ?", [keep.partyId])).length).toBe(2);
    expect((await q("SELECT 1 FROM fu_contacts WHERE party_id = ?", [keep.partyId])).length).toBe(1);
    expect((await q("SELECT 1 FROM fu_cycles WHERE party_id = ? AND status='ACTIVE'", [keep.partyId])).length).toBe(1);
    expect((await q("SELECT party_id FROM book_clients WHERE id = ?", [gone.id]))[0]).toEqual({ party_id: keep.partyId });
    expect((await getParty(gone.partyId))!.id).toBe(keep.partyId); // old id resolves to survivor
    const again = await mergeParties(keep.partyId, gone.partyId, NOW);
    expect(again.ok).toBe(true);
    expect((await q("SELECT 1 FROM fu_merge_log WHERE merged_party_id = ?", [gone.partyId])).length).toBe(1);
  });
});

describe("backfill", () => {
  it("previews, applies, and is idempotent; no historical contacts are fabricated", async () => {
    await ready();
    await db.execute("INSERT INTO book_clients (id, first_name, phone, source) VALUES ('bf1','Backfill','561-555-0100','import')");
    await db.execute("INSERT INTO shipments (id, book_client_id, carrier, tracking_link, sale_amount, shipped_at) VALUES ('bfs1','bf1','USPS','x',750,'2026-10-03T10:00:00')");
    await db.execute("INSERT INTO book_clients (id, first_name, phone, source) VALUES ('bf2','OldTimer','561-555-0200','import')");
    await db.execute("INSERT INTO shipments (id, book_client_id, carrier, tracking_link, sale_amount, shipped_at, shipped_call_done, delivered_at, delivered_call_done) VALUES ('bfs2','bf2','USPS','x',900,'2026-06-03T10:00:00',1,'2026-06-08T10:00:00',1)");
    const contactsBefore = (await q("SELECT 1 FROM fu_contacts")).length;
    const pv = await previewBackfill(NOW);
    expect(pv.ordersFromShipments).toBeGreaterThanOrEqual(2);
    expect(pv.olderSalesNoCycle).toBeGreaterThanOrEqual(1);
    const a = await applyBackfill(NOW);
    expect(a.orders).toBeGreaterThanOrEqual(2);
    const bf1 = (await q<{ party_id: string }>("SELECT party_id FROM book_clients WHERE id = 'bf1'"))[0].party_id;
    const bf2 = (await q<{ party_id: string }>("SELECT party_id FROM book_clients WHERE id = 'bf2'"))[0].party_id;
    expect((await q("SELECT 1 FROM fu_cycles WHERE party_id = ? AND status='ACTIVE'", [bf1])).length).toBe(1);
    expect((await q("SELECT 1 FROM fu_cycles WHERE party_id = ?", [bf2])).length).toBe(0); // old sale → no cycle
    const tasksAfter = (await q("SELECT 1 FROM fu_tasks")).length;
    const b = await applyBackfill(NOW);
    expect(b.orders).toBe(0);
    expect(b.cycles).toBe(0);
    expect((await q("SELECT 1 FROM fu_tasks")).length).toBe(tasksAfter);
    expect((await q("SELECT 1 FROM fu_contacts")).length).toBe(contactsBefore);
  });
});

describe("reactivation", () => {
  it("expired cycles become eligible but nothing enters the queue until selected", async () => {
    const p = await book("React", "407-555-0300");
    await recordSale({ partyId: p.partyId, saleDate: "2026-08-01", idemKey: key(), now: new Date("2026-08-01T15:00:00Z") });
    await reconcile(NOW);
    expect((await getParty(p.partyId))!.reactivationState).toBe("ELIGIBLE");
    let queue = await getDailyQueue(NOW, { pageSize: 500 });
    const find = (qq: typeof queue) => qq.sections.flatMap((x) => x.rows).find((r) => r.partyId === p.partyId);
    expect(find(queue)?.tasks.some((t) => t.category === "REACTIVATION") ?? false).toBe(false);
    const pool = await listReactivationPool({ search: "React" });
    expect(pool.rows.some((r) => r.partyId === p.partyId)).toBe(true);
    expect(await selectForReactivation([p.partyId], NOW)).toBe(1);
    expect(await selectForReactivation([p.partyId], NOW)).toBe(1); // idempotent task
    expect((await q("SELECT 1 FROM fu_tasks WHERE party_id = ? AND category='REACTIVATION' AND status='PENDING'", [p.partyId])).length).toBe(1);
    queue = await getDailyQueue(NOW, { pageSize: 500 });
    expect(find(queue)?.tasks.some((t) => t.category === "REACTIVATION")).toBe(true);
  });

  it("GHOST clients are never selectable", async () => {
    const p = await book("GhostReact", "407-555-0400");
    await logContact({ partyId: p.partyId, channel: "DIALER_CALL", outcome: "GHOST", idemKey: key(), now: NOW });
    expect(await selectForReactivation([p.partyId], NOW)).toBe(0);
  });
});
