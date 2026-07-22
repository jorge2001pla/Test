import { randomUUID } from "node:crypto";
import db, { ready } from "./db";
import { localDateTimeString } from "./business-logic";
import type { CallLogEntry, ClientStatus } from "./types";

export interface BookClient {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  status: ClientStatus;
  notes: string | null;
  callbackScheduledAt: string | null;
  /** 'manual' for clients added through Log New Account/Add Client, 'import' for bulk-loaded
   * legacy records — createdAt on 'import' rows reflects when they were loaded, not real intake,
   * so only 'manual' rows are eligible for the never-called-yet nudge. */
  source: "manual" | "import";
  lifetimeValue: number;
  createdAt: string;
  updatedAt: string;
}

export interface BookClientWithCallLog extends BookClient {
  callLogEntries: CallLogEntry[];
}

interface BookClientRowDb {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  secondary_phone: string | null;
  status: ClientStatus;
  notes: string | null;
  callback_scheduled_at: string | null;
  source: "manual" | "import";
  lifetime_value: number;
  created_at: string;
  updated_at: string;
}

interface BookCallLogRowDb {
  id: string;
  book_client_id: string;
  timestamp: string;
  note_text: string;
  resulting_status: ClientStatus;
}

function mapBookClient(row: BookClientRowDb): BookClient {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    secondaryPhone: row.secondary_phone,
    status: row.status,
    notes: row.notes,
    callbackScheduledAt: row.callback_scheduled_at,
    source: row.source,
    lifetimeValue: row.lifetime_value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBookCallLog(row: BookCallLogRowDb): CallLogEntry {
  return {
    id: row.id,
    clientId: row.book_client_id,
    timestamp: row.timestamp,
    noteText: row.note_text,
    resultingStatus: row.resulting_status,
  };
}

export async function listBookClients(): Promise<BookClient[]> {
  await ready();
  const res = await db.execute("SELECT * FROM book_clients ORDER BY last_name, first_name");
  return (res.rows as unknown as BookClientRowDb[]).map(mapBookClient);
}

export interface BookValueStats {
  whaleCount: number;
  totalValue: number;
}

/** Powers the Whale Tracker — count of clients at the Whale threshold and the book's total
 * tracked value. Threshold is passed in rather than imported, to keep this module decoupled
 * from the tier definitions in business-logic.ts. */
export async function getBookValueStats(whaleThreshold: number): Promise<BookValueStats> {
  await ready();
  const res = await db.execute({
    sql: `SELECT
            COUNT(CASE WHEN lifetime_value >= ? THEN 1 END) as whale_count,
            COALESCE(SUM(lifetime_value), 0) as total_value
          FROM book_clients`,
    args: [whaleThreshold],
  });
  const row = res.rows[0] as unknown as { whale_count: number | string; total_value: number | string };
  return { whaleCount: Number(row.whale_count), totalValue: Number(row.total_value) };
}

export interface BookClientWithLastContact extends BookClient {
  /** Timestamp of the most recent call log entry, or null if this client has never been called. */
  lastContactAt: string | null;
  lastNote: string | null;
}

/** Every book client plus when (and what) they were last called about — powers both the
 * never-called-yet nudge and the dormant reactivation list. */
export async function listBookClientsWithLastContact(): Promise<BookClientWithLastContact[]> {
  await ready();
  const res = await db.execute(`
    SELECT bc.*,
      (SELECT timestamp FROM book_call_log_entries WHERE book_client_id = bc.id ORDER BY timestamp DESC LIMIT 1) AS last_contact_at,
      (SELECT note_text FROM book_call_log_entries WHERE book_client_id = bc.id ORDER BY timestamp DESC LIMIT 1) AS last_note
    FROM book_clients bc
    ORDER BY bc.last_name, bc.first_name
  `);
  const rows = res.rows as unknown as (BookClientRowDb & {
    last_contact_at: string | null;
    last_note: string | null;
  })[];
  return rows.map((row) => ({
    ...mapBookClient(row),
    lastContactAt: row.last_contact_at,
    lastNote: row.last_note,
  }));
}

export async function getBookClient(id: string): Promise<BookClientWithCallLog | undefined> {
  await ready();
  const res = await db.execute({ sql: "SELECT * FROM book_clients WHERE id = ?", args: [id] });
  const row = (res.rows[0] as unknown as BookClientRowDb) ?? undefined;
  if (!row) return undefined;
  const logRes = await db.execute({
    sql: "SELECT * FROM book_call_log_entries WHERE book_client_id = ? ORDER BY timestamp DESC",
    args: [id],
  });
  const logRows = logRes.rows as unknown as BookCallLogRowDb[];
  return { ...mapBookClient(row), callLogEntries: logRows.map(mapBookCallLog) };
}

export interface NewBookClientInput {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  secondaryPhone?: string | null;
  notes?: string | null;
}

export async function createBookClient(input: NewBookClientInput): Promise<BookClient> {
  await ready();
  const id = randomUUID();
  const createdAt = localDateTimeString();
  await db.execute({
    sql: `INSERT INTO book_clients (id, email, first_name, last_name, phone, secondary_phone, notes, source, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
    args: [
      id,
      input.email ?? null,
      input.firstName ?? null,
      input.lastName ?? null,
      input.phone ?? null,
      input.secondaryPhone ?? null,
      input.notes ?? null,
      createdAt,
      createdAt,
    ],
  });
  const res = await db.execute({ sql: "SELECT * FROM book_clients WHERE id = ?", args: [id] });
  return mapBookClient(res.rows[0] as unknown as BookClientRowDb);
}

/** Count of manually-added book clients created within [startIso, endIso) — used for the weekly
 * new-client goal and trend chart. Excludes bulk-imported legacy rows, whose created_at reflects
 * when they were loaded rather than a real "added this week" event. */
export async function countBookClientsCreatedInRange(startIso: string, endIso: string): Promise<number> {
  await ready();
  const res = await db.execute({
    sql: "SELECT COUNT(*) as cnt FROM book_clients WHERE source = 'manual' AND created_at >= ? AND created_at < ?",
    args: [startIso, endIso],
  });
  return Number((res.rows[0] as unknown as { cnt: number | string }).cnt);
}

/** Clears a stale callback without logging a call — resets to No Dispo so the client leaves
 * the Overdue list but stays in the normal rotation. */
export async function clearBookCallback(id: string): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE book_clients SET status = 'NO_DISPO', callback_scheduled_at = NULL, updated_at = datetime('now') WHERE id = ?`,
    args: [id],
  });
}

export async function deleteBookClient(id: string): Promise<void> {
  await ready();
  await db.execute({ sql: "DELETE FROM book_clients WHERE id = ?", args: [id] });
}

/** Overwrites a client's lifetime value — for manual entry/correction (e.g. loading known
 * history from an outside CRM). */
export async function setLifetimeValue(id: string, value: number): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE book_clients SET lifetime_value = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [value, id],
  });
}

/** Adds to a client's running lifetime value — used when a shipment is logged with a sale amount. */
export async function addToLifetimeValue(id: string, amount: number): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE book_clients SET lifetime_value = lifetime_value + ?, updated_at = datetime('now') WHERE id = ?`,
    args: [amount, id],
  });
}

export async function addBookCallLogEntry(
  bookClientId: string,
  noteText: string,
  resultingStatus: ClientStatus,
  callbackScheduledAt: string | null = null,
  promotionId: string | null = null
): Promise<void> {
  await ready();
  const id = randomUUID();
  const scheduledAt = resultingStatus === "CALLBACK" ? callbackScheduledAt : null;
  await db.batch(
    [
      {
        sql: `INSERT INTO book_call_log_entries (id, book_client_id, timestamp, note_text, resulting_status, promotion_id)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [id, bookClientId, localDateTimeString(), noteText, resultingStatus, promotionId],
      },
      {
        sql: `UPDATE book_clients SET status = ?, callback_scheduled_at = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [resultingStatus, scheduledAt, bookClientId],
      },
    ],
    "write"
  );
}

export interface ScheduledBookCallback {
  bookClientId: string;
  clientName: string;
  clientPhone: string | null;
  scheduledAt: string;
}

/** Book clients with a callback scheduled between the two ISO datetimes (inclusive start, exclusive end). */
export async function listScheduledBookCallbacks(
  startIso: string,
  endIso: string
): Promise<ScheduledBookCallback[]> {
  await ready();
  const res = await db.execute({
    sql: `SELECT id, first_name, last_name, phone, callback_scheduled_at FROM book_clients
          WHERE status = 'CALLBACK'
            AND callback_scheduled_at IS NOT NULL
            AND callback_scheduled_at >= ?
            AND callback_scheduled_at < ?
          ORDER BY callback_scheduled_at ASC`,
    args: [startIso, endIso],
  });
  const rows = res.rows as unknown as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    callback_scheduled_at: string;
  }[];
  return rows.map((r) => ({
    bookClientId: r.id,
    clientName: [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unnamed",
    clientPhone: r.phone,
    scheduledAt: r.callback_scheduled_at,
  }));
}
