/**
 * Bridge to the legacy per-record data (dispositions/colors, call logs, callback columns,
 * calendar). The new task/contact tables are the source of truth; these helpers keep the
 * old screens truthful without fabricating anything.
 */
import { naiveEtToUtc, utcToNaiveEt, utcToNaiveEtSec } from "./dates";
import { q, run, uuid, type Stmt } from "./store";
import type { ClientStatus } from "../types";

interface LinkedIds {
  clients: string[];
  books: string[];
}

export async function linkedRecords(partyId: string): Promise<LinkedIds> {
  const c = await q<{ id: string }>("SELECT id FROM clients WHERE party_id = ?", [partyId]);
  const b = await q<{ id: string }>("SELECT id FROM book_clients WHERE party_id = ?", [partyId]);
  return { clients: c.map((r) => r.id), books: b.map((r) => r.id) };
}

/** Statements that add one legacy call-log line (and optionally set the disposition) on every
 * record linked to the person. `status` null keeps each record's current disposition. */
export function legacyLogStmts(
  ids: LinkedIds,
  noteText: string,
  status: ClientStatus | null,
  at: Date,
  opts: { promotionId?: string | null; completeReminders?: boolean } = {}
): Stmt[] {
  const ts = utcToNaiveEtSec(at);
  const day = ts.slice(0, 10);
  const out: Stmt[] = [];
  for (const id of ids.clients) {
    out.push({
      sql: `INSERT INTO call_log_entries (id, client_id, timestamp, note_text, resulting_status)
            SELECT ?, id, ?, ?, ${status ? "?" : "status"} FROM clients WHERE id = ?`,
      args: status ? [uuid(), ts, noteText, status, id] : [uuid(), ts, noteText, id],
    });
    if (status) {
      out.push({ sql: "UPDATE clients SET status = ?, updated_at = datetime('now') WHERE id = ?", args: [status, id] });
    }
  }
  for (const id of ids.books) {
    out.push({
      sql: `INSERT INTO book_call_log_entries (id, book_client_id, timestamp, note_text, resulting_status, promotion_id)
            SELECT ?, id, ?, ?, ${status ? "?" : "status"}, ? FROM book_clients WHERE id = ?`,
      args: status
        ? [uuid(), ts, noteText, status, opts.promotionId ?? null, id]
        : [uuid(), ts, noteText, opts.promotionId ?? null, id],
    });
    if (status) {
      out.push({ sql: "UPDATE book_clients SET status = ?, updated_at = datetime('now') WHERE id = ?", args: [status, id] });
    }
    if (opts.completeReminders) {
      // Existing behavior: a completed call satisfies due follow-up reminders on the book record.
      out.push({
        sql: `UPDATE reminders SET done = 1 WHERE book_client_id = ? AND done = 0 AND due_at IS NOT NULL AND due_at <= ?`,
        args: [id, day],
      });
    }
  }
  return out;
}

/** Mirrors the earliest pending callback task into the legacy callback column so the calendar,
 * Overdue card and profiles agree with the task list. The disposition color is left alone. */
export async function syncLegacyCallback(partyId: string): Promise<void> {
  const rows = await q<{ due_at: string | null; due_date: string }>(
    `SELECT due_at, due_date FROM fu_tasks WHERE party_id = ? AND category = 'CALLBACK' AND status = 'PENDING'
     ORDER BY COALESCE(due_at, due_date) ASC LIMIT 1`,
    [partyId]
  );
  const ids = await linkedRecords(partyId);
  const stmts: Stmt[] = [];
  const naive = rows.length
    ? rows[0].due_at
      ? utcToNaiveEt(new Date(rows[0].due_at))
      : `${rows[0].due_date}T09:00`
    : null;
  for (const [table, list] of [["clients", ids.clients], ["book_clients", ids.books]] as const) {
    for (const id of list) {
      if (naive) {
        stmts.push({
          sql: `UPDATE ${table} SET callback_scheduled_at = ?, updated_at = datetime('now') WHERE id = ? AND COALESCE(callback_scheduled_at,'') != ?`,
          args: [naive, id, naive],
        });
      } else {
        stmts.push({
          sql: `UPDATE ${table} SET callback_scheduled_at = NULL,
                  status = CASE WHEN status = 'CALLBACK' THEN 'NO_DISPO' ELSE status END,
                  updated_at = datetime('now')
                WHERE id = ? AND (callback_scheduled_at IS NOT NULL OR status = 'CALLBACK')`,
          args: [id],
        });
      }
    }
  }
  await run(stmts);
}

export { naiveEtToUtc };
