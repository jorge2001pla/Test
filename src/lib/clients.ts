import { randomUUID } from "node:crypto";
import db, { ready } from "./db";
import { localDateTimeString } from "./business-logic";
import { parseMarks, sweepOnboarding, type OnboardingMarks } from "./onboarding";
import {
  ONBOARDING_EMAILS,
  PRODUCT_INTERESTS,
  type CallLogEntry,
  type Client,
  type ClientStatus,
  type ClientWithCallLog,
  type OnboardingEmailKey,
  type ProductInterestKey,
  type Qualification,
} from "./types";

interface ClientRowDb {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  qualification: string | null;
  product_interests: string | null;
  onboarding_emails: string | null;
  onboarding_started_at: string | null;
  onboarding_auto: string | null;
  onboarding_marks: string | null;
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

const INTEREST_KEYS = new Set<string>(PRODUCT_INTERESTS.map((i) => i.key));
const EMAIL_KEYS = new Set<string>(ONBOARDING_EMAILS.map((e) => e.key));

/** Comma-separated stored keys → validated key array (unknown values dropped). */
function parseKeys<T extends string>(raw: string | null, valid: Set<string>): T[] {
  if (!raw) return [];
  return raw.split(",").filter((k) => valid.has(k)) as T[];
}

function mapClient(row: ClientRowDb): Client {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    qualification: row.qualification === "QUALIFIED" ? "QUALIFIED" : "UNKNOWN",
    productInterests: parseKeys<ProductInterestKey>(row.product_interests, INTEREST_KEYS),
    onboardingEmails: parseKeys<OnboardingEmailKey>(row.onboarding_emails, EMAIL_KEYS),
    onboardingStartedAt: row.onboarding_started_at ?? null,
    onboardingMarks: parseMarks(row.onboarding_marks),
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
  await sweepOnboarding().catch(() => undefined);
  const res = await db.execute("SELECT * FROM clients");
  return (res.rows as unknown as ClientRowDb[]).map(mapClient);
}

export interface ClientWithPreview extends Client {
  lastCallNote: string | null;
  /** Timestamp of the most recent call log entry, or null if never called. */
  lastCallAt: string | null;
}

export async function listClientsWithLastCallNote(): Promise<ClientWithPreview[]> {
  await ready();
  const res = await db.execute(
    `SELECT c.*, (
       SELECT note_text FROM call_log_entries
       WHERE client_id = c.id
       ORDER BY timestamp DESC LIMIT 1
     ) AS last_call_note, (
       SELECT timestamp FROM call_log_entries
       WHERE client_id = c.id
       ORDER BY timestamp DESC LIMIT 1
     ) AS last_call_at
     FROM clients c`
  );
  const rows = res.rows as unknown as (ClientRowDb & {
    last_call_note: string | null;
    last_call_at: string | null;
  })[];
  return rows.map((row) => ({
    ...mapClient(row),
    lastCallNote: row.last_call_note,
    lastCallAt: row.last_call_at,
  }));
}

export async function getClient(id: string): Promise<ClientWithCallLog | undefined> {
  await ready();
  await sweepOnboarding().catch(() => undefined);
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
  email?: string | null;
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
    sql: `INSERT INTO clients (id, name, phone, email, opener, first_sale_date, first_sale_amount, status, notes, onboarding_started_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.name,
      input.phone,
      input.email ?? null,
      input.opener ?? null,
      input.firstSaleDate,
      input.firstSaleAmount ?? null,
      input.status ?? "NO_DISPO",
      input.notes ?? null,
      input.email?.trim() ? new Date().toISOString() : null,
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
  const timestamp = localDateTimeString();
  // A scheduled callback only makes sense while the dispo is actually Callback — any other
  // outcome clears it so stale appointments don't linger on the calendar or priority list.
  const scheduledAt = resultingStatus === "CALLBACK" ? callbackScheduledAt : null;

  const statements = [
    {
      sql: `INSERT INTO call_log_entries (id, client_id, timestamp, note_text, resulting_status)
            VALUES (?, ?, ?, ?, ?)`,
      args: [id, clientId, timestamp, noteText, resultingStatus] as (string | null)[],
    },
    {
      sql: `UPDATE clients SET status = ?, callback_scheduled_at = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [resultingStatus, scheduledAt, clientId] as (string | null)[],
    },
  ];

  // A 15-day client linked into the book is the same person — mirror the call and dispo onto
  // the book record so both profiles show one continuous history.
  const linkRes = await db.execute({
    sql: "SELECT book_client_id FROM clients WHERE id = ?",
    args: [clientId],
  });
  const bookClientId = (linkRes.rows[0] as unknown as { book_client_id: string | null } | undefined)
    ?.book_client_id;
  if (bookClientId) {
    statements.push(
      {
        sql: `INSERT INTO book_call_log_entries (id, book_client_id, timestamp, note_text, resulting_status)
              VALUES (?, ?, ?, ?, ?)`,
        args: [randomUUID(), bookClientId, timestamp, noteText, resultingStatus],
      },
      {
        sql: `UPDATE book_clients SET status = ?, callback_scheduled_at = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [resultingStatus, scheduledAt, bookClientId],
      }
    );
    // A completed call also satisfies any due follow-up reminder on the linked book record
    // (post-delivery check-in / upsell) — Not Available is only an attempt.
    if (resultingStatus !== "NOT_AVAILABLE") {
      statements.push({
        sql: `UPDATE reminders SET done = 1
              WHERE book_client_id = ? AND done = 0 AND due_at IS NOT NULL AND due_at <= ?`,
        args: [bookClientId, timestamp.slice(0, 10)],
      });
    }
  }

  await db.batch(statements, "write");
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

/** Clears a stale callback without logging a call — resets to No Dispo so the client leaves
 * the Overdue list but stays in the normal rotation. */
export async function clearCallback(clientId: string): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE clients SET status = 'NO_DISPO', callback_scheduled_at = NULL, updated_at = datetime('now') WHERE id = ?`,
    args: [clientId],
  });
}

export interface ClientDetailsUpdate {
  name: string;
  phone: string;
  email: string | null;
  opener: string | null;
  firstSaleDate: string;
  firstSaleAmount: number | null;
}

/** Corrects the identity/intake fields on a 15-day client — for typos and mis-entered details,
 * not for dispo changes (those go through call logging). */
export async function updateClientDetails(clientId: string, d: ClientDetailsUpdate): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE clients SET name = ?, phone = ?, email = ?, opener = ?, first_sale_date = ?,
          first_sale_amount = ?,
          onboarding_started_at = CASE WHEN onboarding_started_at IS NULL AND ? != '' THEN ? ELSE onboarding_started_at END,
          updated_at = datetime('now') WHERE id = ?`,
    args: [d.name, d.phone, d.email, d.opener, d.firstSaleDate, d.firstSaleAmount, d.email?.trim() ?? "", new Date().toISOString(), clientId],
  });
}

export interface ClientProfileExtras {
  qualification: Qualification;
  productInterests: ProductInterestKey[];
  onboardingEmails: OnboardingEmailKey[];
}

/** Saves the V1 qualification/interest/onboarding fields — fully independent of
 * disposition, callbacks, and the 15-day window logic. */
export async function updateClientProfileExtras(
  clientId: string,
  extras: ClientProfileExtras
): Promise<void> {
  await ready();
  const cur = await db.execute({ sql: "SELECT onboarding_emails, onboarding_marks FROM clients WHERE id = ?", args: [clientId] });
  const row = cur.rows[0] as unknown as { onboarding_emails: string | null; onboarding_marks: string | null } | undefined;
  const before = new Set((row?.onboarding_emails ?? "").split(",").filter(Boolean));
  const marks: OnboardingMarks = parseMarks(row?.onboarding_marks);
  const next = extras.onboardingEmails.filter((k) => EMAIL_KEYS.has(k));
  for (const k of next) if (!before.has(k)) marks[k] = { at: new Date().toISOString(), by: "manual" };
  for (const k of Object.keys(marks) as OnboardingEmailKey[]) if (!next.includes(k)) delete marks[k];
  await db.execute({
    sql: `UPDATE clients SET qualification = ?, product_interests = ?, onboarding_emails = ?, onboarding_marks = ?,
          updated_at = datetime('now') WHERE id = ?`,
    args: [
      extras.qualification === "QUALIFIED" ? "QUALIFIED" : "UNKNOWN",
      extras.productInterests.filter((k) => INTEREST_KEYS.has(k)).join(",") || null,
      next.join(",") || null,
      JSON.stringify(marks),
      clientId,
    ],
  });
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
