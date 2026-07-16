import { randomUUID } from "node:crypto";
import db, { ready } from "./db";
import { localDateTimeString } from "./business-logic";
import type { CallLogEntry, Client, ClientStatus, ClientWithCallLog } from "./types";

interface ClientRowDb {
  id: string;
  name: string;
  phone: string;
  opener: string | null;
  first_sale_date: string;
  first_sale_amount: number | null;
  status: ClientStatus;
  notes: string | null;
  book_client_id: string | null;
  callback_scheduled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CallLogRowDb {
  id: string;
  client_id: string;
  timestamp: string;
  note_text: string;
  resulting_status: ClientStatus;
}

function mapClient(row: ClientRowDb): Client {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    opener: row.opener,
    firstSaleDate: row.first_sale_date,
    firstSaleAmount: row.first_sale_amount,
    status: row.status,
    notes: row.notes,
    bookClientId: row.book_client_id,
    callbackScheduledAt: row.callback_scheduled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCallLog(row: CallLogRowDb): CallLogEntry {
  return {
    id: row.id,
    clientId: row.client_id,
    timestamp: row.timestamp,
    noteText: row.note_text,
    resultingStatus: row.resulting_status,
  };
}

export async function listClients(): Promise<Client[]> {
  await ready();
  const res = await db.execute("SELECT * FROM clients");
  return (res.rows as unknown as ClientRowDb[]).map(mapClient);
}

export interface ClientWithPreview extends Client {
  lastCallNote: string | null;
}

export async function listClientsWithLastCallNote(): Promise<ClientWithPreview[]> {
  await ready();
  const res = await db.execute(
    `SELECT c.*, (
       SELECT note_text FROM call_log_entries
       WHERE client_id = c.id
       ORDER BY timestamp DESC LIMIT 1
     ) AS last_call_note
     FROM clients c`
  );
  const rows = res.rows as unknown as (ClientRowDb & { last_call_note: string | null })[];
  return rows.map((row) => ({ ...mapClient(row), lastCallNote: row.last_call_note }));
}

export async function getClient(id: string): Promise<ClientWithCallLog | undefined> {
  await ready();
  const res = await db.execute({ sql: "SELECT * FROM clients WHERE id = ?", args: [id] });
  const row = (res.rows[0] as unknown as ClientRowDb) ?? undefined;
  if (!row) return undefined;
  const logRes = await db.execute({
    sql: "SELECT * FROM call_log_entries WHERE client_id = ? ORDER BY timestamp DESC",
    args: [id],
  });
  const logRows = logRes.rows as unknown as CallLogRowDb[];
  return { ...mapClient(row), callLogEntries: logRows.map(mapCallLog) };
}

export interface NewClientInput {
  name: string;
  phone: string;
  opener?: string | null;
  firstSaleDate: string;
  firstSaleAmount?: number | null;
  status?: ClientStatus;
  notes?: string | null;
}

export async function createClient(input: NewClientInput): Promise<Client> {
  await ready();
  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO clients (id, name, phone, opener, first_sale_date, first_sale_amount, status, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.name,
      input.phone,
      input.opener ?? null,
      input.firstSaleDate,
      input.firstSaleAmount ?? null,
      input.status ?? "NO_DISPO",
      input.notes ?? null,
    ],
  });
  return (await getClient(id))!;
}

export async function addCallLogEntry(
  clientId: string,
  noteText: string,
  resultingStatus: ClientStatus,
  callbackScheduledAt: string | null = null
): Promise<void> {
  await ready();
  const id = randomUUID();
  // A scheduled callback only makes sense while the dispo is actually Callback — any other
  // outcome clears it so stale appointments don't linger on the calendar or priority list.
  const scheduledAt = resultingStatus === "CALLBACK" ? callbackScheduledAt : null;
  await db.batch(
    [
      {
        sql: `INSERT INTO call_log_entries (id, client_id, timestamp, note_text, resulting_status)
              VALUES (?, ?, ?, ?, ?)`,
        args: [id, clientId, localDateTimeString(), noteText, resultingStatus],
      },
      {
        sql: `UPDATE clients SET status = ?, callback_scheduled_at = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [resultingStatus, scheduledAt, clientId],
      },
    ],
    "write"
  );
}

export interface ScheduledCallback {
  clientId: string;
  clientName: string;
  clientPhone: string;
  scheduledAt: string;
}

/** Clients with a callback scheduled between the two ISO datetimes (inclusive start, exclusive end). */
export async function listScheduledCallbacks(
  startIso: string,
  endIso: string
): Promise<ScheduledCallback[]> {
  await ready();
  const res = await db.execute({
    sql: `SELECT id, name, phone, callback_scheduled_at FROM clients
          WHERE status = 'CALLBACK'
            AND callback_scheduled_at IS NOT NULL
            AND callback_scheduled_at >= ?
            AND callback_scheduled_at < ?
          ORDER BY callback_scheduled_at ASC`,
    args: [startIso, endIso],
  });
  const rows = res.rows as unknown as {
    id: string;
    name: string;
    phone: string;
    callback_scheduled_at: string;
  }[];
  return rows.map((r) => ({
    clientId: r.id,
    clientName: r.name,
    clientPhone: r.phone,
    scheduledAt: r.callback_scheduled_at,
  }));
}

export async function updateClientNotes(clientId: string, notes: string): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE clients SET notes = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [notes, clientId],
  });
}

export async function linkClientToBook(clientId: string, bookClientId: string): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE clients SET book_client_id = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [bookClientId, clientId],
  });
}

export async function unlinkClientFromBook(clientId: string): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE clients SET book_client_id = NULL, updated_at = datetime('now') WHERE id = ?`,
    args: [clientId],
  });
}
