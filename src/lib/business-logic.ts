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

/** Whole days between a stored date/datetime string's calendar date and `now`. Only the date
 * portion is used (safe for both plain dates and local datetime strings) to match the same
 * UTC-midnight diffing the 15-day window math relies on. */
export function daysSince(dateOrDateTime: string, now: Date = new Date()): number {
  return daysBetween(new Date(dateOrDateTime.slice(0, 10)), now);
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
 * The goal-tracking week containing `now`, shifted back `weeksAgo` full weeks. Weeks run
 * Thursday through Wednesday, per how this business measures its week.
 */
export function weekRangeFor(now: Date, weeksAgo: number = 0): WeekRange {
  const daysSinceThursday = (now.getDay() - 4 + 7) % 7;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceThursday - weeksAgo * 7);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  const lastDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
  return {
    start: `${localDateString(start)}T00:00:00`,
    end: `${localDateString(end)}T00:00:00`,
    label: `${start.toLocaleDateString(undefined, SHORT_DATE)} – ${lastDay.toLocaleDateString(undefined, SHORT_DATE)}`,
  };
}

/** The current goal-tracking week, as of `now`. */
export function currentWeekRange(now: Date = new Date()): WeekRange {
  return weekRangeFor(now, 0);
}

/** How many weeks the trend chart shows at once. */
export const TREND_WEEKS = 8;

/** The last `count` goal-tracking weeks, oldest first, ending with the current (in-progress) week. */
export function recentWeekRanges(count: number, now: Date = new Date()): WeekRange[] {
  const ranges: WeekRange[] = [];
  for (let i = count - 1; i >= 0; i--) {
    ranges.push(weekRangeFor(now, i));
  }
  return ranges;
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

/** How long a never-called book client (no window/deadline of its own) gets proactively
 * surfaced on Today's Priority, counted from when they were added. */
export const NEVER_CALLED_WINDOW_DAYS = 5;

/** How many days since the last logged call before a book client counts as dormant/reactivation-worthy. */
export const DORMANT_DAYS = 30;

/**
 * True for the first few days after a book client is added — the window during which a
 * never-called lead is still hot enough to deserve a proactive nudge on Today's Priority, since
 * book clients have no day-15 deadline to eventually force the issue.
 */
export function isWithinNeverCalledWindow(intakeDate: string, now: Date = new Date()): boolean {
  const since = daysBetween(new Date(intakeDate), now);
  return since >= 0 && since <= NEVER_CALLED_WINDOW_DAYS;
}

/** Minimum size Today's Priority tries to hit by pulling from the Work the Book backlog on
 * light days, so there's always a concrete call list rather than an empty page. */
export const DAILY_QUEUE_TARGET = 10;

interface BacklogClient {
  id: string;
  status: ClientStatus;
  lastContactAt: string | null;
  firstName: string | null;
  lastName: string | null;
}

export type BacklogKind = "dormant" | "never-contacted";

export interface BacklogEntry<T extends BacklogClient> {
  client: T;
  kind: BacklogKind;
}

/**
 * The "Work the Book" queue: clients worth proactively calling when nothing else is due.
 * Cold-after-contact clients rank first (you have history/notes, warmer re-engagement) followed
 * by never-contacted clients — which covers both the bulk-imported legacy book and any manual
 * add that aged out of the never-called nudge without ever getting a call.
 */
export function buildWorkTheBookQueue<T extends BacklogClient>(
  clients: T[],
  now: Date = new Date()
): BacklogEntry<T>[] {
  const dormant = clients
    .filter(
      (c) => c.status !== "NOT_INTERESTED" && c.lastContactAt !== null && daysSince(c.lastContactAt, now) >= DORMANT_DAYS
    )
    .sort((a, b) => (a.lastContactAt as string).localeCompare(b.lastContactAt as string))
    .map((client) => ({ client, kind: "dormant" as const }));

  const neverContacted = clients
    .filter((c) => c.lastContactAt === null && c.status !== "NOT_INTERESTED")
    .sort(
      (a, b) =>
        (a.lastName ?? "").localeCompare(b.lastName ?? "") || (a.firstName ?? "").localeCompare(b.firstName ?? "")
    )
    .map((client) => ({ client, kind: "never-contacted" as const }));

  return [...dormant, ...neverContacted];
}

/**
 * True for 15-day clients who are still uncalled with their window closing soon (5 days or fewer
 * left, but not yet zero — that's the separate "closes today" trigger). Catches leads that would
 * otherwise ride out the whole window untouched and only get flagged on the very last day.
 */
export function isNearingExpiryUncalled(firstSaleDate: string, now: Date = new Date()): boolean {
  if (isWindowExpired(firstSaleDate, now)) return false;
  const daysLeft = daysLeftInWindow(firstSaleDate, now);
  return daysLeft >= 1 && daysLeft <= NEVER_CALLED_WINDOW_DAYS;
}
