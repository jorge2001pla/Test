import { randomUUID } from "node:crypto";
import db, { ready } from "./db";
import { localDateTimeString } from "./business-logic";
import type { ClientStatus } from "./types";

export interface Reminder {
  id: string;
  text: string;
  /** Local YYYY-MM-DD, or null if this reminder has no specific due date. */
  dueAt: string | null;
  done: boolean;
  /** Book client this reminder is about (auto follow-ups), or null for freestanding reminders. */
  bookClientId: string | null;
  createdAt: string;
}

interface ReminderRowDb {
  id: string;
  text: string;
  due_at: string | null;
  done: number;
  book_client_id: string | null;
  created_at: string;
}

function mapReminder(row: ReminderRowDb): Reminder {
  return {
    id: row.id,
    text: row.text,
    dueAt: row.due_at,
    done: !!row.done,
    bookClientId: row.book_client_id,
    createdAt: row.created_at,
  };
}

/** Reminders not yet marked done, due-soonest first, undated ones last. */
export async function listActiveReminders(): Promise<Reminder[]> {
  await ready();
  const res = await db.execute(
    "SELECT * FROM reminders WHERE done = 0 ORDER BY (due_at IS NULL), due_at ASC, created_at ASC"
  );
  return (res.rows as unknown as ReminderRowDb[]).map(mapReminder);
}

export async function createReminder(
  text: string,
  dueAt: string | null,
  bookClientId: string | null = null
): Promise<void> {
  await ready();
  await db.execute({
    sql: `INSERT INTO reminders (id, text, due_at, book_client_id, created_at) VALUES (?, ?, ?, ?, ?)`,
    args: [randomUUID(), text, dueAt, bookClientId, localDateTimeString()],
  });
}

export interface ClientFollowUp extends Reminder {
  clientName: string;
  clientPhone: string | null;
  clientStatus: ClientStatus;
}

/** Client-linked follow-up reminders due on or before `today` (YYYY-MM-DD) — the auto-created
 * post-delivery / upsell calls that feed the Today's Priority queue. They stay in the queue,
 * not just the Reminders card, until the call is actually logged or they're checked off. */
export async function listDueClientFollowUps(today: string): Promise<ClientFollowUp[]> {
  await ready();
  const res = await db.execute({
    sql: `SELECT r.*, b.first_name, b.last_name, b.phone, b.status
          FROM reminders r
          JOIN book_clients b ON b.id = r.book_client_id
          WHERE r.done = 0
            AND r.book_client_id IS NOT NULL
            AND r.due_at IS NOT NULL
            AND r.due_at <= ?
          ORDER BY r.due_at ASC, r.created_at ASC`,
    args: [today],
  });
  const rows = res.rows as unknown as (ReminderRowDb & {
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    status: ClientStatus;
  })[];
  return rows.map((row) => ({
    ...mapReminder(row),
    clientName: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unnamed",
    clientPhone: row.phone,
    clientStatus: row.status,
  }));
}

/** Marks a client's currently-due follow-up reminders done — called when a real call gets
 * logged for that client, so the queue row clears itself without a separate check-off step.
 * Future-dated follow-ups (e.g. the upsell call) are left untouched. */
export async function completeDueFollowUps(bookClientId: string, today: string): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE reminders SET done = 1
          WHERE book_client_id = ? AND done = 0 AND due_at IS NOT NULL AND due_at <= ?`,
    args: [bookClientId, today],
  });
}

export async function setReminderDone(id: string, done: boolean): Promise<void> {
  await ready();
  await db.execute({ sql: "UPDATE reminders SET done = ? WHERE id = ?", args: [done ? 1 : 0, id] });
}

export async function deleteReminder(id: string): Promise<void> {
  await ready();
  await db.execute({ sql: "DELETE FROM reminders WHERE id = ?", args: [id] });
}
