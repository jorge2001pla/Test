import type { Client, ClientStatus } from "./types";

const WINDOW_DAYS = 15;

/** Starting weekly target for new book clients (Thursday–Wednesday week). Bump this as the goal grows. */
export const WEEKLY_GOAL = 10;

function toMidnightUTC(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function daysBetween(from: Date, to: Date): number {
  const ms = toMidnightUTC(to) - toMidnightUTC(from);
  return Math.floor(ms / 86_400_000);
}

/** YYYY-MM-DDTHH:MM:SS in local wall-clock time — for timestamping "now" without SQLite's
 * datetime('now') UTC default, which can land on the wrong calendar day for the user's timezone. */
export function localDateTimeString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}:${s}`;
}

/** YYYY-MM-DD in local wall-clock time — used for "is this scheduled for today" comparisons,
 * since callback_scheduled_at is stored as the literal local date/time the user picked. */
export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Days left in the 15-day, 50%-commission window. Never negative, never manually set. */
export function daysLeftInWindow(firstSaleDate: string, now: Date = new Date()): number {
  const since = daysBetween(new Date(firstSaleDate), now);
  return Math.max(0, WINDOW_DAYS - since);
}

/**
 * True once the 15-day window has actually elapsed (day 16+), as opposed to a client on day 15
 * itself, whose daysLeft is also 0 but who is still in-window for one more day.
 */
export function isWindowExpired(firstSaleDate: string, now: Date = new Date()): boolean {
  const since = daysBetween(new Date(firstSaleDate), now);
  return since > WINDOW_DAYS;
}

const DISINTEREST_PHRASES = [
  "not interested",
  "not into",
  "no interest",
  "doesn't like",
  "don't like",
  "not a fan",
  "not big on",
  "doesn't want",
  "don't want",
];

const MODERN_COIN_TOPICS = ["modern", "certified", "slab", "slabbed", "graded"];

/** Simple keyword check: does the text suggest the client isn't into modern certified coins? */
export function suggestsFallbackPitch(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  const hasDisinterest = DISINTEREST_PHRASES.some((p) => lower.includes(p));
  const hasTopic = MODERN_COIN_TOPICS.some((t) => lower.includes(t));
  return hasDisinterest && hasTopic;
}

type ClientLike = Client & { lastCallNote?: string | null };

export interface FollowUpRow<T extends ClientLike = ClientLike> {
  client: T;
  daysLeft: number;
  fallbackPitch: boolean;
}

export interface FollowUpSections<T extends ClientLike = ClientLike> {
  priority: FollowUpRow<T>[];
  rest: FollowUpRow<T>[];
  notInterested: FollowUpRow<T>[];
  sold: FollowUpRow<T>[];
}

function toRow<T extends ClientLike>(client: T, now: Date): FollowUpRow<T> {
  return {
    client,
    daysLeft: daysLeftInWindow(client.firstSaleDate, now),
    fallbackPitch:
      suggestsFallbackPitch(client.notes) || suggestsFallbackPitch(client.lastCallNote),
  };
}

function bySpendThenDaysLeft<T extends ClientLike>(a: FollowUpRow<T>, b: FollowUpRow<T>): number {
  if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
  const aAmount = a.client.firstSaleAmount ?? -1;
  const bAmount = b.client.firstSaleAmount ?? -1;
  return bAmount - aAmount;
}

/**
 * The 50% follow-up view is scoped to clients still inside their 15-day window — once that
 * window lapses (day 16+) without a Sold/Not Interested outcome, they simply drop off this view
 * entirely (no holding list; the record still exists, it's just not tracked here anymore).
 *
 * Within the window:
 * - `priority`: clients marked Callback, or whose window closes today (their last day) —
 *   sorted by fewest days left, then by first-sale amount (bigger spenders first) as a tiebreak.
 * - `rest`: everyone else still in-window (No Dispo, Not Available), same sort.
 * Not Interested and Sold are their own sections regardless of window status.
 */
export function buildFollowUpSections<T extends ClientLike>(
  clients: T[],
  now: Date = new Date()
): FollowUpSections<T> {
  const rows = clients.map((c) => toRow(c, now));

  const inWindow = rows.filter(
    (r) =>
      (r.client.status === "NO_DISPO" ||
        r.client.status === "CALLBACK" ||
        r.client.status === "NOT_AVAILABLE") &&
      !isWindowExpired(r.client.firstSaleDate, now)
  );

  const priority = inWindow
    .filter((r) => r.client.status === "CALLBACK" || r.daysLeft === 0)
    .sort(bySpendThenDaysLeft);

  const priorityIds = new Set(priority.map((r) => r.client.id));
  const rest = inWindow.filter((r) => !priorityIds.has(r.client.id)).sort(bySpendThenDaysLeft);

  const notInterested = rows
    .filter((r) => r.client.status === "NOT_INTERESTED")
    .sort((a, b) => a.client.name.localeCompare(b.client.name));

  const sold = rows
    .filter((r) => r.client.status === "SOLD")
    .sort((a, b) => b.client.updatedAt.localeCompare(a.client.updatedAt));

  return { priority, rest, notInterested, sold };
}

export type TodayPriorityReason = "window-closing" | "callback" | "both";

export interface TodayPriorityRow<T extends ClientLike = ClientLike> {
  client: T;
  reason: TodayPriorityReason;
  daysLeft: number;
  callbackScheduledAt: string | null;
}

/**
 * The single "what do I need to do today" list: clients whose 15-day window closes today, or
 * who have a callback scheduled for today. This is the daily home-base view — separate from the
 * 50% Follow-Up tab's broader "still in window" list.
 */
export function buildTodaysPriority<T extends ClientLike>(
  clients: T[],
  now: Date = new Date()
): TodayPriorityRow<T>[] {
  const today = localDateString(now);
  const rows: TodayPriorityRow<T>[] = [];

  for (const client of clients) {
    if (client.status === "SOLD" || client.status === "NOT_INTERESTED") continue;

    const windowClosingToday =
      !isWindowExpired(client.firstSaleDate, now) && daysLeftInWindow(client.firstSaleDate, now) === 0;
    const callbackToday =
      client.status === "CALLBACK" &&
      !!client.callbackScheduledAt &&
      client.callbackScheduledAt.slice(0, 10) === today;

    if (!windowClosingToday && !callbackToday) continue;

    rows.push({
      client,
      reason: windowClosingToday && callbackToday ? "both" : windowClosingToday ? "window-closing" : "callback",
      daysLeft: daysLeftInWindow(client.firstSaleDate, now),
      callbackScheduledAt: callbackToday ? client.callbackScheduledAt : null,
    });
  }

  return rows.sort((a, b) => {
    if (a.callbackScheduledAt && b.callbackScheduledAt) {
      return a.callbackScheduledAt.localeCompare(b.callbackScheduledAt);
    }
    if (a.callbackScheduledAt) return -1;
    if (b.callbackScheduledAt) return 1;
    return a.client.name.localeCompare(b.client.name);
  });
}

export interface WeekRange {
  /** Local YYYY-MM-DDTHH:MM:SS, inclusive start (Thursday 00:00). */
  start: string;
  /** Local YYYY-MM-DDTHH:MM:SS, exclusive end (following Thursday 00:00). */
  end: string;
  label: string;
}

const SHORT_DATE = { month: "short", day: "numeric" } as const;

/**
 * The current goal-tracking week, running Thursday through Wednesday (per how this business
 * measures its week), as of `now`.
 */
export function currentWeekRange(now: Date = new Date()): WeekRange {
  const daysSinceThursday = (now.getDay() - 4 + 7) % 7;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceThursday);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  const lastDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
  return {
    start: `${localDateString(start)}T00:00:00`,
    end: `${localDateString(end)}T00:00:00`,
    label: `${start.toLocaleDateString(undefined, SHORT_DATE)} – ${lastDay.toLocaleDateString(undefined, SHORT_DATE)}`,
  };
}

interface CallbackLike {
  status: ClientStatus;
  callbackScheduledAt: string | null;
}

/**
 * Clients/book-clients still marked Callback whose scheduled time has already passed without a
 * follow-up call being logged — these would otherwise silently vanish from "Today's Priority"
 * the moment the day rolls over, so they need their own always-visible list.
 */
export function findMissedCallbacks<T extends CallbackLike>(clients: T[], now: Date = new Date()): T[] {
  const todayStart = `${localDateString(now)}T00:00`;
  return clients
    .filter((c) => c.status === "CALLBACK" && !!c.callbackScheduledAt && c.callbackScheduledAt < todayStart)
    .sort((a, b) => (a.callbackScheduledAt as string).localeCompare(b.callbackScheduledAt as string));
}
