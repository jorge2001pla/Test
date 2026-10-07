/**
 * The complete daily queue (no row cap — pagination only, with exact counts), exception views,
 * and callback alerts. Read-side only; `reconcile()` is run first by the page loaders.
 */
import {
  commissionStatus,
  cycleDay,
  cycleEnd,
  windowDeadlineNeedsAttentionToday,
  type CommissionStatus,
} from "./commission";
import { etDate, formatLocalTime, type DateStr } from "./dates";
import { getConfig, getLinks, mapParty, partyZone, q, type Party, type TaskRow } from "./store";

export const SECTION_TITLES: Record<number, string> = {
  1: "Promised callbacks — due or overdue",
  2: "Delivered — awaiting a successful check-in",
  3: "Shipment exceptions & unresolved service issues",
  4: "Follow-ups due — inside the original 50% window",
  5: "Other due 30-day follow-ups",
  6: "Selected reactivation clients",
};

export interface QueueTask {
  id: string;
  category: string;
  type: string;
  purpose: string;
  dueDate: DateStr;
  dueAt: string | null;
  overdue: boolean;
  cadenceDay: number | null;
  voicemail: boolean;
  textStep: boolean;
  differentPeriod: boolean;
  shipmentId: string | null;
  orderId: string | null;
  section: number;
}

export interface QueueRow {
  partyId: string;
  name: string;
  phone: string | null;
  href: string;
  section: number;
  tasks: QueueTask[];
  why: string;
  localTime: string | null;
  timezone: string;
  timezoneKnown: boolean;
  cycleDay: number | null;
  cycleEnd: DateStr | null;
  commission: CommissionStatus;
  deadlineWarning: boolean;
  latestSaleDate: DateStr | null;
  lastAttemptAt: string | null;
  lastConversationAt: string | null;
  lastPitch: string | null;
  lastObjection: string | null;
  noText: boolean;
  noCalls: boolean;
  noEmail: boolean;
}

export interface QueueSection {
  id: number;
  title: string;
  /** Distinct clients in this section (accurate across all pages). */
  clients: number;
  /** Tasks in this section (a client can have several). */
  tasks: number;
  rows: QueueRow[];
}

export interface DailyQueue {
  today: DateStr;
  sections: QueueSection[];
  totalClients: number;
  totalTasks: number;
  page: number;
  pages: number;
  pageSize: number;
  upcomingCallbacks: { partyId: string; name: string; href: string; dueAt: string; purpose: string; taskId: string }[];
}

function taskSection(t: TaskRow, inWindow: boolean): number {
  switch (t.category) {
    case "CALLBACK": return 1;
    case "DELIVERY": return 2;
    case "SHIPMENT":
    case "SERVICE": return 3;
    case "REACTIVATION": return 6;
    default: return inWindow ? 4 : 5; // CADENCE, MANUAL
  }
}

export async function inChunks<T>(ids: string[], fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 400) out.push(...(await fn(ids.slice(i, i + 400))));
  return out;
}
const ph = (n: number) => Array(n).fill("?").join(",");

export async function getDailyQueue(
  now: Date = new Date(),
  opts: { page?: number; pageSize?: number } = {}
): Promise<DailyQueue> {
  const cfg = await getConfig();
  const today = etDate(now);
  const pageSize = opts.pageSize ?? cfg.pageSize;
  const nowIso = now.toISOString();

  const tasks = await q<TaskRow>(
    `SELECT t.* FROM fu_tasks t JOIN parties p ON p.id = t.party_id
     WHERE t.status = 'PENDING' AND p.merged_into IS NULL
       AND ( (t.due_at IS NOT NULL AND t.due_at <= ?) OR (t.due_at IS NULL AND t.due_date <= ?) )
       AND (p.ghost = 0 OR t.category = 'SERVICE')
     ORDER BY t.due_date, t.created_at`,
    [nowIso, today]
  );
  const partyIds = [...new Set(tasks.map((t) => t.party_id))];
  const parties = new Map<string, Party>();
  const cycles = new Map<string, { start_date: string; end_date: string }>();
  await inChunks(partyIds, async (c) => {
    for (const r of await q<never>(`SELECT * FROM parties WHERE id IN (${ph(c.length)})`, c)) parties.set((r as { id: string }).id, mapParty(r));
    for (const r of await q<{ party_id: string; start_date: string; end_date: string }>(
      `SELECT party_id, start_date, end_date FROM fu_cycles WHERE status = 'ACTIVE' AND party_id IN (${ph(c.length)})`, c)) {
      cycles.set(r.party_id, r);
    }
    return [];
  });

  const byParty = new Map<string, TaskRow[]>();
  for (const t of tasks) byParty.set(t.party_id, [...(byParty.get(t.party_id) ?? []), t]);

  const rows: QueueRow[] = [];
  for (const [partyId, list] of byParty) {
    const p = parties.get(partyId);
    if (!p) continue;
    const comm = commissionStatus(p.openingDate, today);
    const inWindow = comm.eligibility === "IN_WINDOW";
    const qts: QueueTask[] = list.map((t) => ({
      id: t.id, category: t.category, type: t.type, purpose: t.purpose, dueDate: t.due_date, dueAt: t.due_at,
      overdue: t.due_at ? new Date(t.due_at).getTime() < now.getTime() - cfg.callbackGraceMinutes * 60_000 : t.due_date < today,
      cadenceDay: t.cadence_day, voicemail: !!t.voicemail, textStep: !!t.text_step, differentPeriod: !!t.different_period,
      shipmentId: t.shipment_id, orderId: t.order_id, section: taskSection(t, inWindow),
    })).sort((a, b) => a.section - b.section || a.dueDate.localeCompare(b.dueDate));
    const section = qts[0].section;
    const { tz, known } = partyZone(p, cfg);
    const cyc = cycles.get(partyId);
    rows.push({
      partyId,
      name: p.displayName,
      phone: p.phone,
      href: "",
      section,
      tasks: qts,
      why: whyText(qts[0], comm),
      localTime: known ? formatLocalTime(now, tz) : null,
      timezone: tz,
      timezoneKnown: known,
      cycleDay: cyc ? cycleDay(cyc.start_date, today) : null,
      cycleEnd: cyc ? cycleEnd(cyc.start_date) : null,
      commission: comm,
      deadlineWarning: windowDeadlineNeedsAttentionToday(p.openingDate, today, cfg),
      latestSaleDate: p.latestQualifyingSaleDate,
      lastAttemptAt: p.lastAttemptAt,
      lastConversationAt: p.lastConversationAt,
      lastPitch: p.lastPitch,
      lastObjection: p.lastObjection,
      noText: !!p.restrictions.noTexts || !cfg.companyRules.allowTexts,
      noCalls: !!p.restrictions.noCalls,
      noEmail: !!p.restrictions.noEmail,
    });
  }

  // Urgency inside a section: overdue first (oldest due), then fewest commission-window days.
  rows.sort((a, b) =>
    a.section - b.section ||
    Number(b.tasks[0].overdue) - Number(a.tasks[0].overdue) ||
    a.tasks[0].dueDate.localeCompare(b.tasks[0].dueDate) ||
    (a.commission.daysRemaining ?? 99) - (b.commission.daysRemaining ?? 99) ||
    a.name.localeCompare(b.name)
  );

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(1, opts.page ?? 1), pages);
  const slice = rows.slice((page - 1) * pageSize, page * pageSize);

  // Hrefs only for the visible page (one lookup each).
  for (const r of slice) r.href = (await getLinks(r.partyId)).href;

  const sections: QueueSection[] = [1, 2, 3, 4, 5, 6].map((id) => {
    const all = rows.filter((r) => r.section === id);
    return {
      id,
      title: SECTION_TITLES[id],
      clients: all.length,
      tasks: all.reduce((n, r) => n + r.tasks.length, 0),
      rows: slice.filter((r) => r.section === id),
    };
  });

  const up = await q<{ id: string; party_id: string; due_at: string; purpose: string; display_name: string }>(
    `SELECT t.id, t.party_id, t.due_at, t.purpose, p.display_name FROM fu_tasks t JOIN parties p ON p.id = t.party_id
     WHERE t.status = 'PENDING' AND t.category = 'CALLBACK' AND t.due_at > ? AND t.due_date = ? AND p.ghost = 0 ORDER BY t.due_at`,
    [nowIso, today]
  );
  const upcomingCallbacks = [];
  for (const u of up) {
    upcomingCallbacks.push({ partyId: u.party_id, name: u.display_name, href: (await getLinks(u.party_id)).href, dueAt: u.due_at, purpose: u.purpose, taskId: u.id });
  }

  return {
    today, sections, totalClients: rows.length, totalTasks: tasks.length, page, pages, pageSize, upcomingCallbacks,
  };
}

function whyText(t: QueueTask, comm: CommissionStatus): string {
  switch (t.category) {
    case "CALLBACK": return t.overdue ? "Promised callback — overdue" : "Promised callback — due now";
    case "DELIVERY": return "Delivered — confirm receipt";
    case "SHIPMENT": return t.type === "TASK" ? "Shipment info needed" : "Shipped — call the client";
    case "SERVICE": return "Unresolved service issue";
    case "REACTIVATION": return "Reactivation outreach";
    case "CADENCE": return `30-day cadence${t.cadenceDay ? ` — day ${t.cadenceDay} step` : ""}${comm.eligibility === "IN_WINDOW" ? " (50% window)" : ""}`;
    default: return t.overdue ? "Follow-up — overdue" : "Follow-up due";
  }
}

// ── Exception views ───────────────────────────────────────────────────────

export interface ExceptionRow {
  partyId: string;
  name: string;
  href: string;
  detail: string;
  date?: string | null;
  taskId?: string | null;
  shipmentId?: string | null;
}

export interface Exceptions {
  noNextAction: ExceptionRow[];
  overdueCallbacks: ExceptionRow[];
  missedSteps: ExceptionRow[];
  unconfirmedDeliveries: ExceptionRow[];
}

export async function getExceptions(now: Date = new Date()): Promise<Exceptions> {
  const cfg = await getConfig();
  const today = etDate(now);
  const graceIso = new Date(now.getTime() - cfg.callbackGraceMinutes * 60_000).toISOString();

  const noNext = await q<{ party_id: string; display_name: string; end_date: string; pause_reason: string | null; pause_until: string | null }>(
    `SELECT c.party_id, p.display_name, c.end_date, p.pause_reason, p.pause_until
     FROM fu_cycles c JOIN parties p ON p.id = c.party_id
     WHERE c.status = 'ACTIVE' AND p.ghost = 0 AND p.merged_into IS NULL AND c.end_date >= ?
       AND COALESCE(json_extract(p.restrictions,'$.doNotContact'),0) = 0
       AND NOT EXISTS (SELECT 1 FROM fu_tasks t WHERE t.party_id = c.party_id AND t.status = 'PENDING'
                         AND t.category IN ('CADENCE','CALLBACK','MANUAL','REACTIVATION','DELIVERY') )
       AND NOT (p.pause_reason IS NOT NULL AND (p.pause_until IS NULL OR p.pause_until >= ?))
     ORDER BY c.end_date`,
    [today, today]
  );
  const overdueCb = await q<{ id: string; party_id: string; display_name: string; due_at: string | null; due_date: string; purpose: string }>(
    `SELECT t.id, t.party_id, p.display_name, t.due_at, t.due_date, t.purpose FROM fu_tasks t JOIN parties p ON p.id = t.party_id
     WHERE t.status = 'PENDING' AND t.category = 'CALLBACK' AND p.ghost = 0
       AND ((t.due_at IS NOT NULL AND t.due_at < ?) OR (t.due_at IS NULL AND t.due_date < ?))
     ORDER BY COALESCE(t.due_at, t.due_date)`,
    [graceIso, today]
  );
  const missed = await q<{ task_id: string; party_id: string; display_name: string; cadence_day: number | null; due_date: string; at: string }>(
    `SELECT t.id AS task_id, t.party_id, p.display_name, t.cadence_day, t.due_date, e.at
     FROM fu_task_events e JOIN fu_tasks t ON t.id = e.task_id JOIN parties p ON p.id = t.party_id
     JOIN fu_cycles c ON c.id = t.cycle_id AND c.status = 'ACTIVE'
     WHERE e.event = 'MISSED' AND p.ghost = 0 ORDER BY t.due_date DESC`
  );
  const undelivered = await q<{ id: string; party_id: string | null; book_client_id: string; delivered_date: string | null; display_name: string | null }>(
    `SELECT s.id, s.party_id, s.book_client_id, s.delivered_date, p.display_name FROM shipments s
     LEFT JOIN parties p ON p.id = s.party_id
     WHERE (s.delivered_date IS NOT NULL OR s.delivered_at IS NOT NULL) AND s.receipt_confirmed_at IS NULL
       AND s.delivered_call_done = 0 AND s.party_id IS NOT NULL
       AND COALESCE(p.ghost, 0) = 0
     ORDER BY COALESCE(s.delivered_date, s.delivered_at)`
  );

  const mk = async (partyId: string, name: string, detail: string, extra: Partial<ExceptionRow> = {}): Promise<ExceptionRow> => ({
    partyId, name, href: (await getLinks(partyId)).href, detail, ...extra,
  });
  return {
    noNextAction: await Promise.all(noNext.map((r) => mk(r.party_id, r.display_name, `Active cycle ends ${r.end_date} with no scheduled next action`, { date: r.end_date }))),
    overdueCallbacks: await Promise.all(overdueCb.map((r) => mk(r.party_id, r.display_name, r.purpose, { date: r.due_at ?? r.due_date, taskId: r.id }))),
    missedSteps: await Promise.all(missed.map((r) => mk(r.party_id, r.display_name, `Day ${r.cadence_day ?? "?"} step missed (was due ${r.due_date})`, { date: r.due_date, taskId: r.task_id }))),
    unconfirmedDeliveries: await Promise.all(undelivered.map((r) => mk(r.party_id!, r.display_name ?? "Client", `Delivered ${r.delivered_date ?? ""} — receipt not confirmed`, { date: r.delivered_date, shipmentId: r.id }))),
  };
}

// ── Callback alerts (in-app only) ─────────────────────────────────────────

export type AlertLevel = "UPCOMING" | "DUE" | "OVERDUE";
export interface CallbackAlert {
  taskId: string;
  partyId: string;
  name: string;
  phone: string | null;
  href: string;
  dueAt: string;
  level: AlertLevel;
  purpose: string;
}

export async function getCallbackAlerts(now: Date = new Date()): Promise<CallbackAlert[]> {
  const cfg = await getConfig();
  const today = etDate(now);
  const lead = cfg.callbackLeadMinutes * 60_000;
  const grace = cfg.callbackGraceMinutes * 60_000;
  const rows = await q<{ id: string; party_id: string; due_at: string | null; due_date: string; purpose: string; display_name: string; primary_phone: string | null }>(
    `SELECT t.id, t.party_id, t.due_at, t.due_date, t.purpose, p.display_name, p.primary_phone
     FROM fu_tasks t JOIN parties p ON p.id = t.party_id
     WHERE t.status = 'PENDING' AND t.category = 'CALLBACK' AND p.ghost = 0
       AND ((t.due_at IS NOT NULL AND t.due_at <= ?) OR (t.due_at IS NULL AND t.due_date <= ?))
     ORDER BY COALESCE(t.due_at, t.due_date)`,
    [new Date(now.getTime() + lead).toISOString(), today]
  );
  const out: CallbackAlert[] = [];
  for (const r of rows) {
    const at = r.due_at ? new Date(r.due_at) : new Date(`${r.due_date}T13:00:00Z`);
    const diff = now.getTime() - at.getTime();
    const level: AlertLevel = diff < 0 ? "UPCOMING" : diff <= grace ? "DUE" : "OVERDUE";
    out.push({
      taskId: r.id, partyId: r.party_id, name: r.display_name, phone: r.primary_phone,
      href: (await getLinks(r.party_id)).href, dueAt: at.toISOString(), level, purpose: r.purpose,
    });
  }
  return out;
}
