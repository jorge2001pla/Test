/**
 * Task operations the user can do directly (complete / reschedule / cancel / add), legacy
 * callback ingestion, and the shared "after any change" hook.
 */
import { etDate, naiveEtToUtc, nextAllowedSlot, utcToNaiveEt, type DateStr } from "./dates";
import { syncLegacyCallback } from "./legacy";
import {
  closeTask,
  getConfig,
  getParty,
  insertTask,
  partyZone,
  q,
  rescheduleTask,
  run,
  iso,
  type Stmt,
  type TaskRow,
} from "./store";

/** Legacy callbacks (status CALLBACK + callback_scheduled_at, set by older screens) become
 * persistent tasks exactly once. */
export async function ingestLegacyCallbacks(partyId: string, now: Date): Promise<void> {
  const party = await getParty(partyId);
  if (!party || party.ghost || party.restrictions.doNotContact) return;
  const rows = await q<{ cb: string }>(
    `SELECT callback_scheduled_at AS cb FROM clients WHERE party_id = ? AND status = 'CALLBACK' AND callback_scheduled_at IS NOT NULL
     UNION
     SELECT callback_scheduled_at AS cb FROM book_clients WHERE party_id = ? AND status = 'CALLBACK' AND callback_scheduled_at IS NOT NULL`,
    [partyId, partyId]
  );
  const stmts: Stmt[] = [];
  for (const { cb } of rows) {
    const minute = cb.slice(0, 16);
    const key = `cb:${partyId}:${minute}`;
    const seen = await q("SELECT 1 FROM fu_tasks WHERE dedupe_key = ? LIMIT 1", [key]);
    if (seen.length) continue;
    const at = naiveEtToUtc(minute);
    stmts.push(
      ...insertTask(
        {
          partyId,
          category: "CALLBACK",
          type: "CALL",
          purpose: "Promised callback",
          dueDate: etDate(at),
          dueAt: iso(at),
          dedupeKey: key,
          detail: "Imported from the legacy callback field",
        },
        now
      ).stmts
    );
  }
  await run(stmts);
}

export async function afterChange(partyId: string, now: Date): Promise<void> {
  await ingestLegacyCallbacks(partyId, now);
  await syncLegacyCallback(partyId);
}

export function callbackKey(partyId: string, at: Date): string {
  return `cb:${partyId}:${utcToNaiveEt(at)}`;
}

export async function getTask(id: string): Promise<TaskRow | null> {
  return (await q<TaskRow>("SELECT * FROM fu_tasks WHERE id = ?", [id]))[0] ?? null;
}

export async function completeTask(taskId: string, reason: string, now: Date): Promise<string | null> {
  const t = await getTask(taskId);
  if (!t) return "Task not found.";
  if (t.status !== "PENDING") return null; // already closed — idempotent
  await run(closeTask(taskId, "COMPLETED", reason || "Marked done", now));
  await afterChange(t.party_id, now);
  return null;
}

/** Cancellation always carries a reason (history requirement). */
export async function cancelTask(taskId: string, reason: string, now: Date): Promise<string | null> {
  if (!reason.trim()) return "A cancellation reason is required.";
  const t = await getTask(taskId);
  if (!t) return "Task not found.";
  if (t.status !== "PENDING") return null;
  await run(closeTask(taskId, "CANCELLED", reason.trim(), now));
  await afterChange(t.party_id, now);
  return null;
}

/** Moves a task to a new date/time. `when` is an instant for timed tasks (callbacks). The
 * original clock is never touched — only this task's due date. */
export async function rescheduleTaskTo(
  taskId: string,
  when: { date: DateStr; at?: Date | null },
  reason: string,
  now: Date
): Promise<string | null> {
  const t = await getTask(taskId);
  if (!t) return "Task not found.";
  if (t.status !== "PENDING") return "That task is already closed.";
  if (t.category === "CALLBACK" && !when.at) return "A callback needs an exact date and time.";
  const dueAt = when.at ? iso(when.at) : null;
  const dueDate = when.at ? etDate(when.at) : when.date;
  await run(rescheduleTask(taskId, dueDate, dueAt, reason || "Rescheduled", now));
  await afterChange(t.party_id, now);
  return null;
}

/** Manual one-off task ("call back Friday about the Eagles"). */
export async function addManualTask(
  partyId: string,
  input: { purpose: string; dueDate: DateStr; at?: Date | null; category?: "MANUAL" | "CALLBACK" | "SERVICE" },
  idemKey: string,
  now: Date
): Promise<string | null> {
  const party = await getParty(partyId);
  if (!party) return "Client not found.";
  if (!input.purpose.trim()) return "Describe the task.";
  const category = input.category ?? "MANUAL";
  const cfg = await getConfig();
  let dueAt = input.at ? input.at : null;
  if (category === "CALLBACK" && dueAt == null) {
    const { tz } = partyZone(party, cfg);
    dueAt = nextAllowedSlot(new Date(`${input.dueDate}T14:00:00Z`), tz, cfg);
  }
  await run(
    insertTask(
      {
        partyId: party.id,
        category,
        type: category === "SERVICE" ? "TASK" : "CALL",
        purpose: input.purpose.trim(),
        dueDate: dueAt ? etDate(dueAt) : input.dueDate,
        dueAt: dueAt ? iso(dueAt) : null,
        dedupeKey: `manual:${idemKey}`,
      },
      now
    ).stmts
  );
  await afterChange(party.id, now);
  return null;
}
