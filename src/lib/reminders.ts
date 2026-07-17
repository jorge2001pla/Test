import { randomUUID } from "node:crypto";
import db, { ready } from "./db";
import { localDateTimeString } from "./business-logic";

export interface Reminder {
  id: string;
  text: string;
  /** Local YYYY-MM-DD, or null if this reminder has no specific due date. */
  dueAt: string | null;
  done: boolean;
  createdAt: string;
}

interface ReminderRowDb {
  id: string;
  text: string;
  due_at: string | null;
  done: number;
  created_at: string;
}

function mapReminder(row: ReminderRowDb): Reminder {
  return { id: row.id, text: row.text, dueAt: row.due_at, done: !!row.done, createdAt: row.created_at };
}

/** Reminders not yet marked done, due-soonest first, undated ones last. */
export async function listActiveReminders(): Promise<Reminder[]> {
  await ready();
  const res = await db.execute(
    "SELECT * FROM reminders WHERE done = 0 ORDER BY (due_at IS NULL), due_at ASC, created_at ASC"
  );
  return (res.rows as unknown as ReminderRowDb[]).map(mapReminder);
}

export async function createReminder(text: string, dueAt: string | null): Promise<void> {
  await ready();
  await db.execute({
    sql: `INSERT INTO reminders (id, text, due_at, created_at) VALUES (?, ?, ?, ?)`,
    args: [randomUUID(), text, dueAt, localDateTimeString()],
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
