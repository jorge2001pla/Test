/**
 * Everything that can raise an in-app alert: promised callbacks, timed/dated reminders, note
 * reminders, and the count of follow-ups due today. In-app only — these show (and can raise a
 * browser notification) while the app is open in a tab; nothing is sent to a phone.
 */
import { etDate, zonedToUtc, ET } from "./dates";
import { getCallbackAlerts, getDailyQueue } from "./queue";
import { getConfig, q } from "./store";

export type AlertKind = "CALLBACK" | "REMINDER" | "NOTE" | "QUEUE";
export type AlertLevel = "UPCOMING" | "DUE" | "OVERDUE";

export interface AppAlert {
  /** Stable id (kind + record) — used to avoid re-notifying the same thing. */
  id: string;
  kind: AlertKind;
  title: string;
  detail: string;
  href: string;
  /** Exact due instant (ISO), or null for date-only items. */
  dueAt: string | null;
  level: AlertLevel;
  /** Record id the Done/Dismiss button acts on (reminder or note). */
  recordId?: string;
}

function levelFor(dueAt: Date | null, dateOnly: string | null, now: Date, leadMs: number, graceMs: number): AlertLevel | null {
  if (dueAt) {
    const diff = now.getTime() - dueAt.getTime();
    if (diff < -leadMs) return null; // not close enough yet
    if (diff < 0) return "UPCOMING";
    return diff <= graceMs ? "DUE" : "OVERDUE";
  }
  const today = etDate(now);
  if (!dateOnly || dateOnly > today) return null;
  return dateOnly === today ? "DUE" : "OVERDUE";
}

export async function getAlerts(now: Date = new Date()): Promise<AppAlert[]> {
  const cfg = await getConfig();
  const lead = cfg.callbackLeadMinutes * 60_000;
  const grace = cfg.callbackGraceMinutes * 60_000;
  const out: AppAlert[] = [];

  for (const c of await getCallbackAlerts(now)) {
    out.push({
      id: `cb:${c.taskId}`, kind: "CALLBACK", title: c.name, detail: `${c.phone ?? ""} · ${c.purpose}`.replace(/^ · /, ""),
      href: c.href, dueAt: c.dueAt, level: c.level,
    });
  }

  const rem = await q<{ id: string; text: string; due_at: string | null; due_time: string | null }>(
    "SELECT id, text, due_at, due_time FROM reminders WHERE done = 0 AND book_client_id IS NULL AND due_at IS NOT NULL ORDER BY due_at, due_time"
  );
  for (const r of rem) {
    const at = r.due_time ? zonedToUtc(r.due_at!.slice(0, 10), r.due_time, ET) : null;
    const level = levelFor(at, r.due_at!.slice(0, 10), now, lead, grace);
    if (level) out.push({ id: `rem:${r.id}`, kind: "REMINDER", title: r.text, detail: r.due_time ? `Reminder · ${r.due_at!.slice(0, 10)} ${r.due_time}` : `Reminder · due ${r.due_at!.slice(0, 10)}`, href: "/#reminders", dueAt: at?.toISOString() ?? null, level, recordId: r.id });
  }

  const notes = await q<{ id: string; text: string; remind_date: string; remind_time: string | null }>(
    "SELECT id, text, remind_date, remind_time FROM notes WHERE remind_date IS NOT NULL AND COALESCE(remind_done, 0) = 0 ORDER BY remind_date, remind_time"
  );
  for (const n of notes) {
    const at = n.remind_time ? zonedToUtc(n.remind_date.slice(0, 10), n.remind_time, ET) : null;
    const level = levelFor(at, n.remind_date.slice(0, 10), now, lead, grace);
    if (level) out.push({ id: `note:${n.id}`, kind: "NOTE", title: n.text.length > 80 ? `${n.text.slice(0, 80)}…` : n.text, detail: "Note reminder", href: "/#notes", dueAt: at?.toISOString() ?? null, level, recordId: n.id });
  }

  // Follow-ups due today (excluding callbacks, which alert on their own).
  const queue = await getDailyQueue(now, { pageSize: 500 });
  const n = queue.sections.filter((s) => s.id !== 1).reduce((sum, s) => sum + s.clients, 0);
  if (n > 0) {
    out.push({ id: `queue:${etDate(now)}:${n}`, kind: "QUEUE", title: `${n} client${n === 1 ? "" : "s"} to follow up today`, detail: "Open your Daily Queue", href: "/#queue", dueAt: null, level: "DUE" });
  }
  return out;
}
