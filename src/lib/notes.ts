import { randomUUID } from "node:crypto";
import db, { ready } from "./db";
import { localDateTimeString } from "./business-logic";

export interface Note {
  id: string;
  text: string;
  createdAt: string;
}

interface NoteRowDb {
  id: string;
  text: string;
  created_at: string;
}

/** Freeform scratchpad notes, newest first. */
export async function listNotes(): Promise<Note[]> {
  await ready();
  const res = await db.execute("SELECT * FROM notes ORDER BY created_at DESC");
  return (res.rows as unknown as NoteRowDb[]).map((r) => ({
    id: r.id,
    text: r.text,
    createdAt: r.created_at,
  }));
}

export async function createNote(text: string): Promise<void> {
  await ready();
  await db.execute({
    sql: `INSERT INTO notes (id, text, created_at) VALUES (?, ?, ?)`,
    args: [randomUUID(), text, localDateTimeString()],
  });
}

export async function deleteNote(id: string): Promise<void> {
  await ready();
  await db.execute({ sql: "DELETE FROM notes WHERE id = ?", args: [id] });
}
