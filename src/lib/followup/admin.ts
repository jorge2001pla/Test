/**
 * Duplicate review & merge, the reviewable backfill, the reactivation pool, and reports.
 * Nothing here runs automatically except where stated: merges and reactivation need a human
 * decision, and the backfill shows a full preview before it applies.
 */
import { isOwnerOpener } from "../owner";
import { cycleEnd, cycleHasEnded } from "./commission";
import { permissionsFor } from "./config";
import { allPhoneDigits, etDate, naiveEtToUtc, nextWorkdayOnOrAfter, type DateStr } from "./dates";
import { cadenceTasks } from "./sales";
import { afterChange } from "./tasks";
import { reconcile } from "./reconcile";
import {
  closeTask,
  dateOnly,
  ensurePartyForBook,
  ensurePartyForClient,
  getConfig,
  getLinks,
  getParty,
  getPartyRaw,
  insertTask,
  iso,
  mapParty,
  q,
  run,
  uuid,
  type Party,
  type Stmt,
} from "./store";

// ── Duplicate review ──────────────────────────────────────────────────────

export interface DuplicateSide {
  partyId: string;
  name: string;
  phones: string[];
  email: string | null;
  openingDate: string | null;
  href: string;
  orders: number;
  contacts: number;
  pendingTasks: number;
  activeCycle: boolean;
  records: string;
}

export interface DuplicatePair {
  a: DuplicateSide;
  b: DuplicateSide;
  reasons: string[];
  conflicts: string[];
}

/** Candidate pairs share a phone number or email. NEVER name alone — names are shown only as a hint. */
export async function findDuplicates(limit = 200): Promise<DuplicatePair[]> {
  const parties = (await q<never>("SELECT * FROM parties WHERE merged_into IS NULL")).map((r) => mapParty(r));
  const phoneRows = await q<{ party_id: string; phone: string | null; secondary: string | null; email: string | null }>(
    `SELECT party_id, phone, NULL AS secondary, NULL AS email FROM clients WHERE party_id IS NOT NULL
     UNION ALL SELECT party_id, phone, secondary_phone, email FROM book_clients WHERE party_id IS NOT NULL`
  );
  const phones = new Map<string, Set<string>>();
  const emails = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, id: string, v: string | null) => {
    if (!v) return;
    if (!m.has(id)) m.set(id, new Set());
    m.get(id)!.add(v);
  };
  for (const p of parties) {
    for (const d of allPhoneDigits(p.phone)) add(phones, p.id, d);
    if (p.email) add(emails, p.id, p.email.trim().toLowerCase());
  }
  for (const r of phoneRows) {
    for (const d of allPhoneDigits(r.phone, r.secondary)) add(phones, r.party_id, d);
    if (r.email) add(emails, r.party_id, r.email.trim().toLowerCase());
  }
  const byKey = new Map<string, Set<string>>();
  const index = (m: Map<string, Set<string>>, prefix: string) => {
    for (const [pid, vals] of m) for (const v of vals) {
      const k = `${prefix}:${v}`;
      if (!byKey.has(k)) byKey.set(k, new Set());
      byKey.get(k)!.add(pid);
    }
  };
  index(phones, "phone");
  index(emails, "email");

  const pairs = new Map<string, { a: string; b: string; reasons: Set<string> }>();
  for (const [k, ids] of byKey) {
    if (ids.size < 2 || ids.size > 6) continue; // a number shared by many is a switchboard, not a duplicate
    const list = [...ids].sort();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const pk = `${list[i]}|${list[j]}`;
      if (!pairs.has(pk)) pairs.set(pk, { a: list[i], b: list[j], reasons: new Set() });
      pairs.get(pk)!.reasons.add(k.startsWith("phone") ? "Same phone number" : "Same email address");
    }
  }
  const dismissed = new Set((await q<{ party_a: string; party_b: string }>("SELECT * FROM fu_duplicate_dismissals")).map((d) => `${d.party_a}|${d.party_b}`));
  const byId = new Map(parties.map((p) => [p.id, p]));

  const out: DuplicatePair[] = [];
  for (const [pk, v] of pairs) {
    if (dismissed.has(pk)) continue;
    const pa = byId.get(v.a), pb = byId.get(v.b);
    if (!pa || !pb) continue;
    const [a, b] = [await side(pa, phones), await side(pb, phones)];
    const conflicts: string[] = [];
    if (pa.openingDate && pb.openingDate && pa.openingDate !== pb.openingDate) conflicts.push(`Different opening dates (${pa.openingDate} vs ${pb.openingDate})`);
    if (a.activeCycle && b.activeCycle) conflicts.push("Both have an active 30-day cycle (the newer one is kept)");
    if (pa.ghost !== pb.ghost) conflicts.push("One is marked GHOST");
    if (pa.displayName.trim().toLowerCase() !== pb.displayName.trim().toLowerCase()) conflicts.push("Names differ");
    out.push({ a, b, reasons: [...v.reasons], conflicts });
    if (out.length >= limit) break;
  }
  return out;
}

async function side(p: Party, phones: Map<string, Set<string>>): Promise<DuplicateSide> {
  const [o, c, t, cy, recs, links] = await Promise.all([
    q<{ n: number }>("SELECT COUNT(*) AS n FROM fu_orders WHERE party_id = ?", [p.id]),
    q<{ n: number }>("SELECT COUNT(*) AS n FROM fu_contacts WHERE party_id = ?", [p.id]),
    q<{ n: number }>("SELECT COUNT(*) AS n FROM fu_tasks WHERE party_id = ? AND status = 'PENDING'", [p.id]),
    q("SELECT 1 FROM fu_cycles WHERE party_id = ? AND status = 'ACTIVE'", [p.id]),
    q<{ k: string; n: number }>(`SELECT 'clients' AS k, COUNT(*) AS n FROM clients WHERE party_id = ? UNION ALL SELECT 'book', COUNT(*) FROM book_clients WHERE party_id = ?`, [p.id, p.id]),
    getLinks(p.id),
  ]);
  const kinds = recs.filter((r) => Number(r.n) > 0).map((r) => (r.k === "clients" ? "50% list" : "Book"));
  return {
    partyId: p.id, name: p.displayName, phones: [...(phones.get(p.id) ?? [])], email: p.email, openingDate: p.openingDate,
    href: links.href, orders: Number(o[0].n), contacts: Number(c[0].n), pendingTasks: Number(t[0].n),
    activeCycle: cy.length > 0, records: kinds.join(" + ") || "—",
  };
}

export async function dismissDuplicate(a: string, b: string): Promise<void> {
  const [x, y] = [a, b].sort();
  await run([{ sql: "INSERT OR IGNORE INTO fu_duplicate_dismissals (party_a, party_b) VALUES (?, ?)", args: [x, y] }]);
}

export interface MergeResult {
  ok: boolean;
  error?: string;
  conflicts: string[];
  keptId?: string;
}

/** Merges `mergeId` INTO `keepId` after explicit human confirmation. All source ids, histories,
 * orders, tasks, contacts and shipments are preserved (re-pointed); conflicts are flagged and logged. */
export async function mergeParties(keepId: string, mergeId: string, now: Date = new Date()): Promise<MergeResult> {
  if (keepId === mergeId) return { ok: false, error: "Pick two different people.", conflicts: [] };
  const [keep, gone] = [await getPartyRaw(keepId), await getPartyRaw(mergeId)];
  if (!keep || !gone) return { ok: false, error: "Client not found.", conflicts: [] };
  if (gone.mergedInto) return { ok: true, conflicts: [], keptId: gone.mergedInto }; // already merged — idempotent
  if (keep.mergedInto) return { ok: false, error: "The client you chose to keep was already merged into another.", conflicts: [] };
  const conflicts: string[] = [];
  if (keep.openingDate && gone.openingDate && keep.openingDate !== gone.openingDate) {
    conflicts.push(`Opening date kept as ${keep.openingDate}; the other record said ${gone.openingDate}`);
  }
  const ts = iso(now);
  const stmts: Stmt[] = [];

  // Active-cycle collision: keep the newer cycle, close the older with a clear reason.
  const cyc = await q<{ id: string; party_id: string; start_date: string }>(
    "SELECT id, party_id, start_date FROM fu_cycles WHERE status = 'ACTIVE' AND party_id IN (?, ?)", [keepId, mergeId]);
  if (cyc.length === 2) {
    const older = cyc.sort((x, y) => x.start_date.localeCompare(y.start_date))[0];
    conflicts.push("Both had an active cycle — the older was closed as MERGED");
    stmts.push({ sql: "UPDATE fu_cycles SET status = 'CLOSED', close_reason = 'MERGED', closed_at = ? WHERE id = ?", args: [ts, older.id] });
    for (const t of await q<{ id: string }>("SELECT id FROM fu_tasks WHERE cycle_id = ? AND category = 'CADENCE' AND status = 'PENDING'", [older.id])) {
      stmts.push(...closeTask(t.id, "SUPERSEDED", "Duplicate cycle merged", now));
    }
  }
  // Pending tasks that would duplicate one the kept person already has.
  for (const t of await q<{ id: string; dedupe_key: string | null }>("SELECT id, dedupe_key FROM fu_tasks WHERE party_id = ? AND status = 'PENDING' AND dedupe_key IS NOT NULL", [mergeId])) {
    const dup = await q("SELECT 1 FROM fu_tasks WHERE party_id = ? AND dedupe_key = ? AND status = 'PENDING'", [keepId, t.dedupe_key]);
    if (dup.length) stmts.push(...closeTask(t.id, "SUPERSEDED", "Duplicate of the kept client’s task", now));
  }
  for (const table of ["fu_orders", "fu_cycles", "fu_tasks", "fu_contacts", "shipments", "clients", "book_clients"]) {
    stmts.push({ sql: `UPDATE ${table} SET party_id = ? WHERE party_id = ?`, args: [keepId, mergeId] });
  }
  const restr = { ...gone.restrictions, ...keep.restrictions };
  for (const k of Object.keys(gone.restrictions) as (keyof typeof restr)[]) if (gone.restrictions[k]) restr[k] = true;
  stmts.push({
    sql: `UPDATE parties SET
            opening_date = COALESCE(opening_date, ?), opening_date_source = COALESCE(opening_date_source, ?),
            first_call_deal = MAX(first_call_deal, ?), email = COALESCE(email, ?), timezone = COALESCE(timezone, ?),
            latest_qualifying_sale_date = CASE WHEN COALESCE(latest_qualifying_sale_date,'') >= COALESCE(?, '') THEN latest_qualifying_sale_date ELSE ? END,
            last_attempt_at = CASE WHEN COALESCE(last_attempt_at,'') >= COALESCE(?, '') THEN last_attempt_at ELSE ? END,
            last_conversation_at = CASE WHEN COALESCE(last_conversation_at,'') >= COALESCE(?, '') THEN last_conversation_at ELSE ? END,
            interests = COALESCE(interests, ?), last_pitch = COALESCE(last_pitch, ?), last_objection = COALESCE(last_objection, ?),
            restrictions = ?, ghost = MAX(ghost, ?), updated_at = ?
          WHERE id = ?`,
    args: [gone.openingDate, gone.openingDateSource, gone.firstCallDeal ? 1 : 0, gone.email, gone.timezone,
      gone.latestQualifyingSaleDate, gone.latestQualifyingSaleDate, gone.lastAttemptAt, gone.lastAttemptAt,
      gone.lastConversationAt, gone.lastConversationAt, gone.interests, gone.lastPitch, gone.lastObjection,
      JSON.stringify(restr), gone.ghost ? 1 : 0, ts, keepId],
  });
  stmts.push({ sql: "UPDATE parties SET merged_into = ?, updated_at = ? WHERE id = ?", args: [keepId, ts, mergeId] });
  stmts.push({
    sql: "INSERT INTO fu_merge_log (id, kept_party_id, merged_party_id, at, snapshot, conflicts) VALUES (?,?,?,?,?,?)",
    args: [uuid(), keepId, mergeId, ts, JSON.stringify({ keep, merged: gone }), JSON.stringify(conflicts)],
  });
  await run(stmts);
  await afterChange(keepId, now);
  return { ok: true, conflicts, keptId: keepId };
}

// ── Backfill (reviewable) ─────────────────────────────────────────────────

export interface BackfillPreview {
  records: { clients: number; bookClients: number; linkedPairs: number };
  partiesToCreate: number;
  alreadyHaveParty: number;
  ordersFromShipments: number;
  ordersFromOwnerOpenedPromos: number;
  cyclesToStart: { partyName: string; saleDate: string; day: number; remainingSteps: number }[];
  cyclesToStartTotal: number;
  olderSalesNoCycle: number;
  deliveryTasks: number;
  shippedCallTasks: number;
  legacyCallbacksToImport: number;
  duplicateCandidates: number;
  notDone: string[];
}

interface ClientRec { id: string; name: string; phone: string; opener: string | null; first_sale_date: string; first_sale_amount: number | null; book_client_id: string | null; party_id: string | null }
interface BookRec { id: string; first_name: string | null; last_name: string | null; party_id: string | null }
interface ShipRec { id: string; book_client_id: string; sale_amount: number | null; shipped_at: string; shipped_call_done: number; delivered_at: string | null; delivered_call_done: number; order_id: string | null; party_id: string | null }

export async function previewBackfill(now: Date = new Date()): Promise<BackfillPreview> {
  const today = etDate(now);
  const cfg = await getConfig();
  const clients = await q<ClientRec>("SELECT id, name, phone, opener, first_sale_date, first_sale_amount, book_client_id, party_id FROM clients");
  const books = await q<BookRec>("SELECT id, first_name, last_name, party_id FROM book_clients");
  const ships = await q<ShipRec>("SELECT id, book_client_id, sale_amount, shipped_at, shipped_call_done, delivered_at, delivered_call_done, order_id, party_id FROM shipments");
  const linked = clients.filter((c) => c.book_client_id).length;
  const bookIdsLinked = new Set(clients.filter((c) => c.book_client_id).map((c) => c.book_client_id));
  const needParty =
    clients.filter((c) => !c.party_id).length +
    books.filter((b) => !b.party_id && !bookIdsLinked.has(b.id)).length;

  const sales = new Map<string, { name: string; date: string }>(); // key by person (book id or client id)
  const consider = (key: string, name: string, date: string) => {
    const cur = sales.get(key);
    if (!cur || date > cur.date) sales.set(key, { name, date });
  };
  let ownerPromos = 0;
  for (const c of clients) {
    if (isOwnerOpener(c.opener) && dateOnly(c.first_sale_date)) {
      ownerPromos++;
      consider(c.book_client_id ?? c.id, c.name, c.first_sale_date.slice(0, 10));
    }
  }
  let fromShips = 0;
  const bookName = new Map(books.map((b) => [b.id, [b.first_name, b.last_name].filter(Boolean).join(" ") || "Unnamed"]));
  for (const s of ships) {
    if (s.sale_amount && !s.order_id) {
      fromShips++;
      consider(s.book_client_id, bookName.get(s.book_client_id) ?? "Client", s.shipped_at.slice(0, 10));
    }
  }
  const starts: BackfillPreview["cyclesToStart"] = [];
  let older = 0;
  for (const v of sales.values()) {
    if (cycleHasEnded(v.date, today) || v.date > today) { older++; continue; }
    const steps = cfg.cadence.steps.filter((s) => `${addDaysStr(v.date, s.day - 1)}` >= today).length;
    starts.push({ partyName: v.name, saleDate: v.date, day: diff(v.date, today) + 1, remainingSteps: steps });
  }
  starts.sort((a, b) => b.saleDate.localeCompare(a.saleDate));
  const recent = (d: string | null) => !!d && diff(d.slice(0, 10), today) <= 14;
  const legacyCb = Number((await q<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM clients WHERE status='CALLBACK' AND callback_scheduled_at IS NOT NULL)
          + (SELECT COUNT(*) FROM book_clients WHERE status='CALLBACK' AND callback_scheduled_at IS NOT NULL) AS n`))[0].n);
  const dups = (await findDuplicates(1000)).length;
  return {
    records: { clients: clients.length, bookClients: books.length, linkedPairs: linked },
    partiesToCreate: needParty,
    alreadyHaveParty: clients.filter((c) => c.party_id).length + books.filter((b) => b.party_id).length,
    ordersFromShipments: fromShips,
    ordersFromOwnerOpenedPromos: ownerPromos,
    cyclesToStart: starts.slice(0, 100),
    cyclesToStartTotal: starts.length,
    olderSalesNoCycle: older,
    deliveryTasks: ships.filter((s) => s.delivered_at && !s.delivered_call_done && recent(s.delivered_at)).length,
    shippedCallTasks: ships.filter((s) => !s.shipped_call_done && recent(s.shipped_at)).length,
    legacyCallbacksToImport: legacyCb,
    duplicateCandidates: dups,
    notDone: [
      "No historical contact attempts are created — legacy call logs stay exactly where they are.",
      "No catch-up calls: only future cadence steps for sales in the last 30 days are scheduled.",
      "Older clients are NOT enrolled in any cycle; they can enter the reactivation pool via a review step.",
      "No duplicates are merged automatically.",
    ],
  };
}

const addDaysStr = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const diff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export interface BackfillResult {
  parties: number;
  orders: number;
  cycles: number;
  tasks: number;
  callbacksImported: number;
}

/** Applies the backfill. Idempotent: every row is keyed, so a second run changes nothing. */
export async function applyBackfill(now: Date = new Date()): Promise<BackfillResult> {
  const today = etDate(now);
  const cfg = await getConfig();
  const before = Number((await q<{ n: number }>("SELECT COUNT(*) AS n FROM parties"))[0].n);

  // 1. Canonical identity for every record (linked pairs share one person).
  for (const c of await q<{ id: string }>("SELECT id FROM clients WHERE party_id IS NULL")) await ensurePartyForClient(c.id);
  for (const b of await q<{ id: string }>("SELECT id FROM book_clients WHERE party_id IS NULL")) await ensurePartyForBook(b.id);
  const parties = Number((await q<{ n: number }>("SELECT COUNT(*) AS n FROM parties"))[0].n) - before;

  // 2. Orders (real sales we already know about — never invented).
  const stmts: Stmt[] = [];
  let orders = 0;
  for (const c of await q<ClientRec>("SELECT id, name, phone, opener, first_sale_date, first_sale_amount, book_client_id, party_id FROM clients WHERE party_id IS NOT NULL")) {
    const d = dateOnly(c.first_sale_date);
    if (!d || !isOwnerOpener(c.opener)) continue;
    const exists = await q("SELECT 1 FROM fu_orders WHERE idem_key = ?", [`bf-client:${c.id}`]);
    if (exists.length) continue;
    stmts.push({
      sql: `INSERT INTO fu_orders (id, party_id, sale_date, amount, qualifying, kind, source, idem_key, created_at)
            VALUES (?,?,?,?,1,'PROMO_OPENER','backfill',?,?)`,
      args: [uuid(), c.party_id, d, c.first_sale_amount, `bf-client:${c.id}`, iso(now)],
    });
    orders++;
  }
  for (const s of await q<ShipRec>("SELECT id, book_client_id, sale_amount, shipped_at, shipped_call_done, delivered_at, delivered_call_done, order_id, party_id FROM shipments")) {
    const partyId = s.party_id ?? (await q<{ party_id: string | null }>("SELECT party_id FROM book_clients WHERE id = ?", [s.book_client_id]))[0]?.party_id;
    if (!partyId) continue;
    const oid = uuid();
    if (s.sale_amount && !s.order_id) {
      const exists = await q("SELECT id FROM fu_orders WHERE idem_key = ?", [`bf-ship:${s.id}`]);
      if (!exists.length) {
        stmts.push({
          sql: `INSERT INTO fu_orders (id, party_id, sale_date, amount, qualifying, kind, source, idem_key, created_at)
                VALUES (?,?,?,?,1,'SALE','backfill',?,?)`,
          args: [oid, partyId, s.shipped_at.slice(0, 10), s.sale_amount, `bf-ship:${s.id}`, iso(now)],
        });
        stmts.push({ sql: "UPDATE shipments SET party_id = ?, order_id = ? WHERE id = ?", args: [partyId, oid, s.id] });
        orders++;
      }
    } else if (!s.party_id) {
      stmts.push({ sql: "UPDATE shipments SET party_id = ? WHERE id = ?", args: [partyId, s.id] });
    }
    // Recent open shipment obligations only (no backlog).
    const rec = (d: string | null) => !!d && diff(d.slice(0, 10), today) <= 14;
    if (!s.shipped_call_done && rec(s.shipped_at)) {
      stmts.push(...insertTask({ partyId, shipmentId: s.id, category: "SHIPMENT", type: "CALL", purpose: "Call: your order has shipped",
        dueDate: nextWorkdayOnOrAfter(today, cfg), dedupeKey: `shipcall:${s.id}` }, now).stmts);
    }
    if (s.delivered_at && !s.delivered_call_done && diff(s.delivered_at.slice(0, 10), today) <= 7) {
      stmts.push(...insertTask({ partyId, shipmentId: s.id, category: "DELIVERY", type: "CALL", purpose: "Delivery check-in: confirm receipt & satisfaction",
        dueDate: today, dedupeKey: `delivery:${s.id}` }, now).stmts);
    }
  }
  await run(stmts);

  // 3. Latest qualifying sale per person, and last attempt / conversation from real legacy logs.
  await run([{
    sql: `UPDATE parties SET latest_qualifying_sale_date = (
            SELECT MAX(sale_date) FROM fu_orders o WHERE o.party_id = parties.id AND o.qualifying = 1)
          WHERE EXISTS (SELECT 1 FROM fu_orders o WHERE o.party_id = parties.id AND o.qualifying = 1)`,
    args: [],
  }]);
  const logs = await q<{ party_id: string; ts: string; attempt: number }>(
    `SELECT c.party_id, l.timestamp AS ts, CASE WHEN l.resulting_status = 'NOT_AVAILABLE' THEN 1 ELSE 0 END AS attempt
       FROM call_log_entries l JOIN clients c ON c.id = l.client_id WHERE c.party_id IS NOT NULL
     UNION ALL
     SELECT b.party_id, l.timestamp, CASE WHEN l.resulting_status = 'NOT_AVAILABLE' THEN 1 ELSE 0 END
       FROM book_call_log_entries l JOIN book_clients b ON b.id = l.book_client_id WHERE b.party_id IS NOT NULL`
  );
  const lastAny = new Map<string, string>(), lastConv = new Map<string, string>();
  for (const l of logs) {
    const t = naiveEtToUtc(l.ts).toISOString();
    if (!lastAny.has(l.party_id) || lastAny.get(l.party_id)! < t) lastAny.set(l.party_id, t);
    if (!l.attempt && (!lastConv.has(l.party_id) || lastConv.get(l.party_id)! < t)) lastConv.set(l.party_id, t);
  }
  const upd: Stmt[] = [];
  for (const [pid, t] of lastAny) upd.push({ sql: "UPDATE parties SET last_attempt_at = CASE WHEN last_attempt_at IS NULL OR last_attempt_at < ? THEN ? ELSE last_attempt_at END WHERE id = ?", args: [t, t, pid] });
  for (const [pid, t] of lastConv) upd.push({ sql: "UPDATE parties SET last_conversation_at = CASE WHEN last_conversation_at IS NULL OR last_conversation_at < ? THEN ? ELSE last_conversation_at END WHERE id = ?", args: [t, t, pid] });
  await run(upd);

  // 4. Cycles only for people whose latest qualifying sale is inside the last 30 days.
  let cycles = 0, tasks = 0;
  const cand = (await q<never>(`SELECT * FROM parties WHERE merged_into IS NULL AND latest_qualifying_sale_date IS NOT NULL AND ghost = 0`)).map((r) => mapParty(r));
  for (const p of cand) {
    const d = p.latestQualifyingSaleDate!;
    if (cycleHasEnded(d, today) || d > today) continue;
    const has = await q("SELECT 1 FROM fu_cycles WHERE party_id = ? LIMIT 1", [p.id]);
    if (has.length) continue;
    const orderRow = await q<{ id: string }>("SELECT id FROM fu_orders WHERE party_id = ? AND qualifying = 1 AND sale_date = ? ORDER BY created_at LIMIT 1", [p.id, d]);
    const cid = uuid();
    const s: Stmt[] = [{
      sql: `INSERT INTO fu_cycles (id, party_id, order_id, start_date, end_date, status, created_at) VALUES (?,?,?,?,?, 'ACTIVE', ?)`,
      args: [cid, p.id, orderRow[0]?.id ?? null, d, cycleEnd(d), iso(now)],
    }];
    const made = cadenceTasks(p.id, cid, orderRow[0]?.id ?? null, d, today, cfg, p, now);
    s.push(...made.stmts);
    await run(s);
    cycles++;
    tasks += made.count;
  }

  // 5. Legacy callbacks → tasks (existing obligations, not new backlog).
  const cbBefore = Number((await q<{ n: number }>("SELECT COUNT(*) AS n FROM fu_tasks WHERE category='CALLBACK'"))[0].n);
  await reconcile(now);
  const cbAfter = Number((await q<{ n: number }>("SELECT COUNT(*) AS n FROM fu_tasks WHERE category='CALLBACK'"))[0].n);

  const result = { parties, orders, cycles, tasks, callbacksImported: cbAfter - cbBefore };
  await run([{ sql: "INSERT INTO fu_backfill_runs (id, at, summary) VALUES (?,?,?)", args: [uuid(), iso(now), JSON.stringify(result)] }]);
  return result;
}

// ── Reactivation ──────────────────────────────────────────────────────────

export interface ReactivationRow {
  partyId: string;
  name: string;
  phone: string | null;
  href: string;
  state: string;
  lastSale: string | null;
  lastConversationAt: string | null;
  lastObjection: string | null;
  lifetimeValue: number;
}

export async function listReactivationPool(opts: { state?: string; search?: string; limit?: number; offset?: number } = {}): Promise<{ rows: ReactivationRow[]; total: number }> {
  const state = opts.state === "SELECTED" || opts.state === "DISMISSED" ? opts.state : "ELIGIBLE";
  const search = opts.search?.trim();
  const where = `p.merged_into IS NULL AND p.reactivation_state = ? AND p.ghost = 0
     AND COALESCE(json_extract(p.restrictions,'$.doNotContact'),0) = 0
     AND NOT EXISTS (SELECT 1 FROM fu_cycles c WHERE c.party_id = p.id AND c.status = 'ACTIVE')
     ${search ? "AND (p.display_name LIKE ? OR p.primary_phone LIKE ?)" : ""}`;
  const args: (string | number)[] = [state, ...(search ? [`%${search}%`, `%${search}%`] : [])];
  const total = Number((await q<{ n: number }>(`SELECT COUNT(*) AS n FROM parties p WHERE ${where}`, args))[0].n);
  const rows = await q<{ id: string; display_name: string; primary_phone: string | null; reactivation_state: string; latest_qualifying_sale_date: string | null; last_conversation_at: string | null; last_objection: string | null; ltv: number | null }>(
    `SELECT p.*, (SELECT SUM(lifetime_value) FROM book_clients b WHERE b.party_id = p.id) AS ltv
     FROM parties p WHERE ${where} ORDER BY ltv DESC, p.display_name LIMIT ? OFFSET ?`,
    [...args, opts.limit ?? 50, opts.offset ?? 0]
  );
  const out: ReactivationRow[] = [];
  for (const r of rows) {
    out.push({ partyId: r.id, name: r.display_name, phone: r.primary_phone, href: (await getLinks(r.id)).href, state: r.reactivation_state,
      lastSale: r.latest_qualifying_sale_date, lastConversationAt: r.last_conversation_at, lastObjection: r.last_objection, lifetimeValue: Number(r.ltv ?? 0) });
  }
  return { rows: out, total };
}

/** Marks reviewed clients as selected and gives each a single reactivation task. Explicit
 * human action only — the pool is never auto-enrolled. */
export async function selectForReactivation(partyIds: string[], now: Date = new Date()): Promise<number> {
  const cfg = await getConfig();
  const today = etDate(now);
  let n = 0;
  for (const id of partyIds) {
    const p = await getParty(id);
    if (!p || p.ghost || p.restrictions.doNotContact) continue;
    if (!permissionsFor(p.restrictions, p.ghost, cfg).call && !permissionsFor(p.restrictions, p.ghost, cfg).text) continue;
    const stmts: Stmt[] = [
      { sql: "UPDATE parties SET reactivation_state = 'SELECTED', reactivation_at = ?, updated_at = ? WHERE id = ?", args: [iso(now), iso(now), p.id] },
      ...insertTask({ partyId: p.id, category: "REACTIVATION", type: "CALL", purpose: "Reactivation call", dueDate: nextWorkdayOnOrAfter(today, cfg),
        dedupeKey: `react:${p.id}` }, now).stmts,
    ];
    await run(stmts);
    n++;
  }
  return n;
}

export async function dismissReactivation(partyIds: string[], now: Date = new Date()): Promise<void> {
  await run(partyIds.map((id) => ({ sql: "UPDATE parties SET reactivation_state = 'DISMISSED', reactivation_at = ? WHERE id = ?", args: [iso(now), id] })));
}

// ── Reports ───────────────────────────────────────────────────────────────

export interface Report {
  activeCycles: number;
  cycleDayBuckets: { label: string; count: number }[];
  contacts7d: { attempts: number; conversations: number; voicemails: number };
  closedByReason: { reason: string; count: number }[];
  commissionByKind: { kind: string; count: number; amount: number }[];
  overdueTasks: number;
  pendingTasks: number;
  reactivationEligible: number;
  reactivationSelected: number;
}

export async function getReport(now: Date = new Date()): Promise<Report> {
  const today = etDate(now);
  const week = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const cycles = await q<{ start_date: string }>("SELECT start_date FROM fu_cycles WHERE status = 'ACTIVE'");
  const buckets = [["Days 1–7", 1, 7], ["Days 8–15", 8, 15], ["Days 16–23", 16, 23], ["Days 24–30", 24, 30]] as const;
  const dayOf = (s: string) => diff(s, today) + 1;
  const c7 = (await q<{ attempts: number; conv: number; vm: number }>(
    "SELECT COUNT(*) AS attempts, COALESCE(SUM(reached),0) AS conv, COALESCE(SUM(voicemail_left),0) AS vm FROM fu_contacts WHERE occurred_at >= ?", [week]))[0];
  const monthStart = today.slice(0, 8) + "01";
  return {
    activeCycles: cycles.length,
    cycleDayBuckets: buckets.map(([label, lo, hi]) => ({ label, count: cycles.filter((c) => { const d = dayOf(c.start_date); return d >= lo && d <= hi; }).length })),
    contacts7d: { attempts: Number(c7.attempts), conversations: Number(c7.conv), voicemails: Number(c7.vm) },
    closedByReason: (await q<{ close_reason: string; n: number }>("SELECT close_reason, COUNT(*) AS n FROM fu_cycles WHERE status = 'CLOSED' AND closed_at >= ? GROUP BY close_reason", [new Date(now.getTime() - 60 * 86_400_000).toISOString()]))
      .map((r) => ({ reason: r.close_reason ?? "—", count: Number(r.n) })),
    commissionByKind: (await q<{ commission_kind: string; n: number; amt: number }>("SELECT commission_kind, COUNT(*) AS n, COALESCE(SUM(amount),0) AS amt FROM fu_orders WHERE qualifying = 1 AND sale_date >= ? GROUP BY commission_kind", [monthStart]))
      .map((r) => ({ kind: r.commission_kind ?? "—", count: Number(r.n), amount: Number(r.amt) })),
    overdueTasks: Number((await q<{ n: number }>("SELECT COUNT(*) AS n FROM fu_tasks WHERE status='PENDING' AND due_date < ?", [today]))[0].n),
    pendingTasks: Number((await q<{ n: number }>("SELECT COUNT(*) AS n FROM fu_tasks WHERE status='PENDING'"))[0].n),
    reactivationEligible: Number((await q<{ n: number }>("SELECT COUNT(*) AS n FROM parties WHERE reactivation_state='ELIGIBLE' AND merged_into IS NULL"))[0].n),
    reactivationSelected: Number((await q<{ n: number }>("SELECT COUNT(*) AS n FROM parties WHERE reactivation_state='SELECTED' AND merged_into IS NULL"))[0].n),
  };
}

export type { DateStr };
