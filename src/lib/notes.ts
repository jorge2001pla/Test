import { randomUUID } from "node:crypto";
import db, { ready } from "./db";
import { localDateTimeString } from "./business-logic";

export interface Note {
  id: string;
  text: string;
  createdAt: string;
  /** Optional in-app reminder on this note (Eastern date + time), until dismissed. */
  remindDate: string | null;
  remindTime: string | null;
  remindDone: boolean;
}

interface NoteRowDb {
  id: string;
  text: string;
  created_at: string;
  remind_date?: string | null;
  remind_time?: string | null;
  remind_done?: number;
}

/** Freeform scratchpad notes, newest first. */
export async function listNotes(): Promise<Note[]> {
  await ready();
  const res = await db.execute("SELECT * FROM notes ORDER BY created_at DESC");
  return (res.rows as unknown as NoteRowDb[]).map((r) => ({
    id: r.id,
    text: r.text,
    createdAt: r.created_at,
    remindDate: r.remind_date ?? null,
    remindTime: r.remind_time ?? null,
    remindDone: !!r.remind_done,
  }));
}

export async function createNote(text: string, remindDate: string | null = null, remindTime: string | null = null): Promise<void> {
  await ready();
  await db.execute({
    sql: `INSERT INTO notes (id, text, created_at, remind_date, remind_time, remind_done) VALUES (?, ?, ?, ?, ?, 0)`,
    args: [randomUUID(), text, localDateTimeString(), remindDate, remindDate ? remindTime : null],
  });
}

/** Dismisses a note's reminder without deleting the note. */
export async function dismissNoteReminder(id: string): Promise<void> {
  await ready();
  await db.execute({ sql: "UPDATE notes SET remind_done = 1 WHERE id = ?", args: [id] });
}

export async function deleteNote(id: string): Promise<void> {
  await ready();
  await db.execute({ sql: "DELETE FROM notes WHERE id = ?", args: [id] });
}
