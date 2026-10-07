/**
 * Storage primitives for the follow-up system: settings, canonical parties, task + event writes.
 * Every multi-row change is built as a list of statements and sent as ONE db.batch (atomic), and
 * every generated row carries a dedupe/idempotency key so re-running a request can't duplicate.
 */
import { randomUUID } from "node:crypto";
import db, { ready } from "../db";
import { DEFAULT_CONFIG, parseConfig, parseRestrictions, type FollowUpConfig, type Restrictions } from "./config";
import { addDays, etDate, inferTimezoneFromPhone, type DateStr } from "./dates";

export type Arg = string | number | null;
export interface Stmt {
  sql: string;
  args: Arg[];
}

export const uuid = () => randomUUID();
export const iso = (d: Date) => d.toISOString();

export async function q<T = Record<string, unknown>>(sql: string, args: Arg[] = []): Promise<T[]> {
  await ready();
  const res = await db.execute({ sql, args });
  return res.rows as unknown as T[];
}

export async function run(stmts: Stmt[]): Promise<void> {
  await ready();
  if (stmts.length) await db.batch(stmts, "write");
}

// ── Settings ──────────────────────────────────────────────────────────────

export async function getConfig(): Promise<FollowUpConfig> {
  const rows = await q<{ value: string }>("SELECT value FROM fu_settings WHERE key = 'config'");
  return rows.length ? parseConfig(rows[0].value) : DEFAULT_CONFIG;
}

export async function saveConfig(cfg: FollowUpConfig): Promise<void> {
  await ready();
  await db.execute({
    sql: `INSERT INTO fu_settings (key, value, updated_at) VALUES ('config', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [JSON.stringify(cfg), iso(new Date())],
  });
}

// ── Parties ───────────────────────────────────────────────────────────────

export interface Party {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  timezone: string | null;
  timezoneSource: string | null;
  openingDate: DateStr | null;
  openingDateSource: string | null;
  firstCallDeal: boolean;
  latestQualifyingSaleDate: DateStr | null;
  lastAttemptAt: string | null;
  lastConversationAt: string | null;
  interests: string | null;
  lastPitch: string | null;
  lastObjection: string | null;
  restrictions: Restrictions;
  ghost: boolean;
  reactivationState: string;
  pauseReason: string | null;
  pauseUntil: string | null;
  mergedInto: string | null;
  notes: string | null;
}

interface PartyRow {
  id: string;
  display_name: string;
  primary_phone: string | null;
  email: string | null;
  timezone: string | null;
  timezone_source: string | null;
  opening_date: string | null;
  opening_date_source: string | null;
  first_call_deal: number;
  latest_qualifying_sale_date: string | null;
  last_attempt_at: string | null;
  last_conversation_at: string | null;
  interests: string | null;
  last_pitch: string | null;
  last_objection: string | null;
  restrictions: string | null;
  ghost: number;
  reactivation_state: string;
  pause_reason: string | null;
  pause_until: string | null;
  merged_into: string | null;
  notes: string | null;
}

export function mapParty(r: PartyRow): Party {
  return {
    id: r.id,
    displayName: r.display_name,
    phone: r.primary_phone,
    email: r.email,
    timezone: r.timezone,
    timezoneSource: r.timezone_source,
    openingDate: r.opening_date,
    openingDateSource: r.opening_date_source,
    firstCallDeal: !!r.first_call_deal,
    latestQualifyingSaleDate: r.latest_qualifying_sale_date,
    lastAttemptAt: r.last_attempt_at,
    lastConversationAt: r.last_conversation_at,
    interests: r.interests,
    lastPitch: r.last_pitch,
    lastObjection: r.last_objection,
    restrictions: parseRestrictions(r.restrictions),
    ghost: !!r.ghost,
    reactivationState: r.reactivation_state,
    pauseReason: r.pause_reason,
    pauseUntil: r.pause_until,
    mergedInto: r.merged_into,
    notes: r.notes,
  };
}

/** Follows merged_into so a stale id from an old link still lands on the surviving person. */
export async function resolvePartyId(id: string): Promise<string> {
  let cur = id;
  for (let i = 0; i < 10; i++) {
    const rows = await q<{ merged_into: string | null }>("SELECT merged_into FROM parties WHERE id = ?", [cur]);
    if (!rows.length || !rows[0].merged_into) return cur;
    cur = rows[0].merged_into;
  }
  return cur;
}

export async function getParty(id: string): Promise<Party | null> {
  const rid = await resolvePartyId(id);
  const rows = await q<PartyRow>("SELECT * FROM parties WHERE id = ?", [rid]);
  return rows.length ? mapParty(rows[0]) : null;
}

/** The party row exactly as stored — does NOT follow merged_into (used by merge). */
export async function getPartyRaw(id: string): Promise<Party | null> {
  const rows = await q<PartyRow>("SELECT * FROM parties WHERE id = ?", [id]);
  return rows.length ? mapParty(rows[0]) : null;
}

export function dateOnly(s: string | null | undefined): DateStr | null {
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

interface ClientBits {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  first_sale_date: string;
  product_interests: string | null;
  book_client_id: string | null;
  party_id: string | null;
}
interface BookBits {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  secondary_phone: string | null;
  email: string | null;
  party_id: string | null;
}

const bookName = (b: BookBits) => [b.first_name, b.last_name].filter(Boolean).join(" ") || "Unnamed";

/** The canonical person for a 50%-list client — created on first need, never by name matching.
 * A client linked to a book record (book_client_id) is the SAME person by explicit user link. */
export async function ensurePartyForClient(clientId: string): Promise<string | null> {
  const rows = await q<ClientBits>("SELECT * FROM clients WHERE id = ?", [clientId]);
  const c = rows[0];
  if (!c) return null;
  if (c.party_id) return resolvePartyId(c.party_id);
  let book: BookBits | undefined;
  if (c.book_client_id) {
    book = (await q<BookBits>("SELECT * FROM book_clients WHERE id = ?", [c.book_client_id]))[0];
    if (book?.party_id) {
      await run([{ sql: "UPDATE clients SET party_id = ? WHERE id = ? AND party_id IS NULL", args: [book.party_id, c.id] }]);
      return resolvePartyId(book.party_id);
    }
  }
  const id = uuid();
  const phone = [c.phone, book?.phone, book?.secondary_phone].filter(Boolean).join(";") || null;
  const tz = inferTimezoneFromPhone(c.phone);
  const now = iso(new Date());
  const stmts: Stmt[] = [
    {
      sql: `INSERT INTO parties (id, display_name, primary_phone, email, timezone, timezone_source, opening_date,
              opening_date_source, interests, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, c.name, c.phone || phone, c.email ?? book?.email ?? null, tz, tz ? "area_code" : null,
        dateOnly(c.first_sale_date), dateOnly(c.first_sale_date) ? "clients.first_sale_date" : null,
        c.product_interests, now, now],
    },
    { sql: "UPDATE clients SET party_id = ? WHERE id = ? AND party_id IS NULL", args: [id, c.id] },
  ];
  if (book) stmts.push({ sql: "UPDATE book_clients SET party_id = ? WHERE id = ? AND party_id IS NULL", args: [id, book.id] });
  await run(stmts);
  const after = await q<{ party_id: string | null }>("SELECT party_id FROM clients WHERE id = ?", [c.id]);
  return after[0]?.party_id ? resolvePartyId(after[0].party_id) : id;
}

/** The canonical person for a book client (created on first need). */
export async function ensurePartyForBook(bookId: string): Promise<string | null> {
  const rows = await q<BookBits>("SELECT * FROM book_clients WHERE id = ?", [bookId]);
  const b = rows[0];
  if (!b) return null;
  if (b.party_id) return resolvePartyId(b.party_id);
  const linked = await q<{ id: string }>("SELECT id FROM clients WHERE book_client_id = ? LIMIT 1", [bookId]);
  if (linked.length) return ensurePartyForClient(linked[0].id);
  const id = uuid();
  const tz = inferTimezoneFromPhone(b.phone);
  const now = iso(new Date());
  await run([
    {
      sql: `INSERT INTO parties (id, display_name, primary_phone, email, timezone, timezone_source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, bookName(b), [b.phone, b.secondary_phone].filter(Boolean).join(";") || null, b.email, tz,
        tz ? "area_code" : null, now, now],
    },
    { sql: "UPDATE book_clients SET party_id = ? WHERE id = ? AND party_id IS NULL", args: [id, b.id] },
  ]);
  const after = await q<{ party_id: string | null }>("SELECT party_id FROM book_clients WHERE id = ?", [b.id]);
  return after[0]?.party_id ? resolvePartyId(after[0].party_id) : id;
}

export interface PartyLinks {
  clientId: string | null;
  bookClientId: string | null;
  /** Where to send the user to open this person's profile. */
  href: string;
}

export async function getLinks(partyId: string): Promise<PartyLinks> {
  const c = await q<{ id: string }>("SELECT id FROM clients WHERE party_id = ? ORDER BY created_at LIMIT 1", [partyId]);
  const b = await q<{ id: string }>("SELECT id FROM book_clients WHERE party_id = ? ORDER BY created_at LIMIT 1", [partyId]);
  const clientId = c[0]?.id ?? null;
  const bookClientId = b[0]?.id ?? null;
  return {
    clientId,
    bookClientId,
    href: bookClientId ? `/book/${bookClientId}` : clientId ? `/clients/${clientId}` : "/",
  };
}

/** Party zone with fallback chain: explicit → inferred from phone → configured default. */
export function partyZone(p: Pick<Party, "timezone" | "phone">, cfg: FollowUpConfig): { tz: string; known: boolean } {
  if (p.timezone) return { tz: p.timezone, known: true };
  const inferred = inferTimezoneFromPhone(p.phone);
  return inferred ? { tz: inferred, known: true } : { tz: cfg.defaultTimezone, known: false };
}

// ── Task statements ───────────────────────────────────────────────────────

export type TaskCategory = "CALLBACK" | "DELIVERY" | "SHIPMENT" | "SERVICE" | "CADENCE" | "REACTIVATION" | "MANUAL";
export type TaskStatus = "PENDING" | "COMPLETED" | "CANCELLED" | "SUPERSEDED";

export interface NewTask {
  partyId: string;
  cycleId?: string | null;
  orderId?: string | null;
  shipmentId?: string | null;
  category: TaskCategory;
  type?: "CALL" | "TEXT" | "EMAIL" | "TASK";
  channel?: string | null;
  purpose: string;
  dueDate: DateStr;
  dueAt?: string | null;
  cadenceDay?: number | null;
  cadenceKey?: string | null;
  voicemail?: boolean;
  textStep?: boolean;
  differentPeriod?: boolean;
  dedupeKey: string;
  detail?: string | null;
}

/** INSERT that silently no-ops when a PENDING task with the same dedupe key already exists, plus
 * a CREATED event only when the task really was inserted. Returns the new task id. */
export function insertTask(t: NewTask, now: Date): { id: string; stmts: Stmt[] } {
  const id = uuid();
  const ts = iso(now);
  return {
    id,
    stmts: [
      {
        sql: `INSERT INTO fu_tasks (id, party_id, cycle_id, order_id, shipment_id, category, type, channel, purpose,
                due_date, due_at, cadence_day, cadence_key, voicemail, text_step, different_period, status,
                dedupe_key, detail, created_at, updated_at)
              SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'PENDING', ?,?,?,?
              WHERE NOT EXISTS (SELECT 1 FROM fu_tasks WHERE dedupe_key = ? AND status = 'PENDING')`,
        args: [id, t.partyId, t.cycleId ?? null, t.orderId ?? null, t.shipmentId ?? null, t.category,
          t.type ?? "CALL", t.channel ?? null, t.purpose, t.dueDate, t.dueAt ?? null, t.cadenceDay ?? null,
          t.cadenceKey ?? null, t.voicemail ? 1 : 0, t.textStep ? 1 : 0, t.differentPeriod ? 1 : 0,
          t.dedupeKey, t.detail ?? null, ts, ts, t.dedupeKey],
      },
      {
        sql: `INSERT INTO fu_task_events (id, task_id, at, event, reason)
              SELECT ?, ?, ?, 'CREATED', ? WHERE EXISTS (SELECT 1 FROM fu_tasks WHERE id = ?)`,
        args: [uuid(), id, ts, t.purpose, id],
      },
    ],
  };
}

/** Moves one PENDING task to a final status, with a reason and a history event. */
export function closeTask(
  taskId: string,
  status: Exclude<TaskStatus, "PENDING">,
  reason: string,
  now: Date,
  contactId?: string | null
): Stmt[] {
  const ts = iso(now);
  return [
    {
      sql: `UPDATE fu_tasks SET status = ?, status_reason = ?, status_at = ?, completed_contact_id = ?, updated_at = ?
            WHERE id = ? AND status = 'PENDING'`,
      args: [status, reason, ts, contactId ?? null, ts, taskId],
    },
    {
      sql: `INSERT INTO fu_task_events (id, task_id, at, event, reason)
            SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM fu_tasks WHERE id = ? AND status = ? AND status_at = ?)`,
      args: [uuid(), taskId, ts, status, reason, taskId, status, ts],
    },
  ];
}

export function rescheduleTask(
  taskId: string,
  dueDate: DateStr,
  dueAt: string | null,
  reason: string,
  now: Date
): Stmt[] {
  const ts = iso(now);
  return [
    {
      sql: `UPDATE fu_tasks SET due_date = ?, due_at = ?, updated_at = ? WHERE id = ? AND status = 'PENDING'`,
      args: [dueDate, dueAt, ts, taskId],
    },
    {
      sql: `INSERT INTO fu_task_events (id, task_id, at, event, reason, detail)
            SELECT ?, ?, ?, 'RESCHEDULED', ?, ? WHERE EXISTS (SELECT 1 FROM fu_tasks WHERE id = ? AND status = 'PENDING')`,
      args: [uuid(), taskId, ts, reason, `${dueDate}${dueAt ? " " + dueAt : ""}`, taskId],
    },
  ];
}

export function logTaskEvent(taskId: string, event: string, reason: string, now: Date): Stmt {
  return {
    sql: `INSERT INTO fu_task_events (id, task_id, at, event, reason) VALUES (?, ?, ?, ?, ?)`,
    args: [uuid(), taskId, iso(now), event, reason],
  };
}

export interface TaskRow {
  id: string;
  party_id: string;
  cycle_id: string | null;
  order_id: string | null;
  shipment_id: string | null;
  category: TaskCategory;
  type: string;
  channel: string | null;
  purpose: string;
  due_date: string;
  due_at: string | null;
  cadence_day: number | null;
  cadence_key: string | null;
  voicemail: number;
  text_step: number;
  different_period: number;
  status: TaskStatus;
  status_reason: string | null;
  status_at: string | null;
  dedupe_key: string | null;
  detail: string | null;
  created_at: string;
}

export async function pendingTasks(partyId: string): Promise<TaskRow[]> {
  return q<TaskRow>("SELECT * FROM fu_tasks WHERE party_id = ? AND status = 'PENDING' ORDER BY due_date, created_at", [partyId]);
}

export const todayET = (now: Date) => etDate(now);
export { addDays };

/** Guarantees the person has a book record (creating and linking one from their 50%-list entry
 * if needed). Called whenever Jorge records a sale or opened the account, so those clients always
 * land in his book. Idempotent; never touches an existing book record. */
export async function ensureBookClient(partyId: string): Promise<string | null> {
  const existing = await q<{ id: string }>("SELECT id FROM book_clients WHERE party_id = ? LIMIT 1", [partyId]);
  if (existing.length) return existing[0].id;
  const c = (await q<ClientBits & { name: string }>("SELECT * FROM clients WHERE party_id = ? ORDER BY created_at LIMIT 1", [partyId]))[0];
  const p = await getPartyRaw(partyId);
  const full = (c?.name ?? p?.displayName ?? "").trim();
  if (!full) return null;
  const [first, ...rest] = full.split(/\s+/);
  const id = uuid();
  const now = new Date().toISOString();
  const stmts: Stmt[] = [
    {
      sql: `INSERT INTO book_clients (id, first_name, last_name, phone, email, source, party_id)
            SELECT ?, ?, ?, ?, ?, 'manual', ? WHERE NOT EXISTS (SELECT 1 FROM book_clients WHERE party_id = ?)`,
      args: [id, first || null, rest.join(" ") || null, c?.phone ?? p?.phone?.split(";")[0] ?? null, c?.email ?? p?.email ?? null, partyId, partyId],
    },
  ];
  if (c) {
    stmts.push({
      sql: "UPDATE clients SET book_client_id = (SELECT id FROM book_clients WHERE party_id = ? LIMIT 1) WHERE id = ? AND book_client_id IS NULL",
      args: [partyId, c.id],
    });
  }
  stmts.push({ sql: "UPDATE parties SET updated_at = ? WHERE id = ?", args: [now, partyId] });
  await run(stmts);
  const after = await q<{ id: string }>("SELECT id FROM book_clients WHERE party_id = ? LIMIT 1", [partyId]);
  return after[0]?.id ?? null;
}
