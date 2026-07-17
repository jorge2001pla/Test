import Link from "next/link";
import { listClientsWithLastCallNote, listScheduledCallbacks } from "@/lib/clients";
import {
  listBookClientsWithLastContact,
  listScheduledBookCallbacks,
  countBookClientsCreatedInRange,
  getBookValueStats,
} from "@/lib/book";
import { listActiveShipments, listShipmentsNeedingCallToday } from "@/lib/shipments";
import { listActiveReminders } from "@/lib/reminders";
import { listNotes } from "@/lib/notes";
import { getActivePromotion, getPromotionProgress, listNotCalledAboutPromotion } from "@/lib/promotions";
import {
  buildFollowUpSections,
  buildTodaysPriority,
  buildWorkTheBookQueue,
  currentWeekRange,
  DAILY_QUEUE_TARGET,
  daysLeftInWindow,
  DORMANT_DAYS,
  daysSince,
  findMissedCallbacks,
  isNearingExpiryUncalled,
  localDateString,
  recentWeekRanges,
  remainingWorkdays,
  TREND_WEEKS,
  VALUE_TIER_THRESHOLDS,
  WEEKLY_GOAL,
  WHALE_GOAL_COUNT,
  WHALE_GOAL_VALUE,
} from "@/lib/business-logic";
import { formatCallbackTime, formatDate, formatTimeOnly, formatWholeCurrency } from "@/lib/format";
import type { ClientStatus } from "@/lib/types";
import MonthCalendar, { type CalendarCallback } from "@/components/MonthCalendar";
import ShipmentActions from "@/components/ShipmentActions";
import ReminderItem from "@/components/ReminderItem";
import NoteItem from "@/components/NoteItem";
import WeeklyTrendChart from "@/components/WeeklyTrendChart";
import PhoneLink from "@/components/PhoneLink";
import TrackingLink from "@/components/TrackingLink";
import PriorityRowItem, { type PriorityRowData } from "@/components/PriorityRowItem";
import { createReminderAction, createNoteAction } from "@/app/actions";

export const dynamic = "force-dynamic";

function monthParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** Row shape used while building the list — adds sort/grouping fields dropped before rendering. */
interface BuildRow extends PriorityRowData {
  sortKey: string;
  /** 0 = 50% expiring soon, 1 = callback today, 2 = shipment needs a call, 3 = active promo
   * not yet called, 4 = backlog fill. */
  tier: number;
}

interface OverdueRow {
  id: string;
  name: string;
  phone: string;
  href: string;
  status: ClientStatus;
  reasonLabel: string;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParamValue } = await searchParams;
  const now = new Date();

  let year = now.getFullYear();
  let month = now.getMonth();
  if (monthParamValue && /^\d{4}-\d{2}$/.test(monthParamValue)) {
    const [y, m] = monthParamValue.split("-").map(Number);
    year = y;
    month = m - 1;
  }

  const clients = await listClientsWithLastCallNote();
  const sections = buildFollowUpSections(clients);
  const bookClients = await listBookClientsWithLastContact();
  const bookCount = bookClients.length;
  const todaysWindowAndCallbacks = buildTodaysPriority(clients, now);
  const activeShipments = await listActiveShipments();
  const shipmentsNeedingCall = await listShipmentsNeedingCallToday();

  const workQueue = buildWorkTheBookQueue(bookClients, now);
  const dormantCount = workQueue.filter((e) => e.kind === "dormant").length;

  const activePromotion = await getActivePromotion();
  const [promotionProgress, promoTargets, valueStats] = await Promise.all([
    activePromotion ? getPromotionProgress(activePromotion.id) : Promise.resolve(null),
    activePromotion ? listNotCalledAboutPromotion(activePromotion.id) : Promise.resolve([]),
    getBookValueStats(VALUE_TIER_THRESHOLDS.whale),
  ]);

  const neverCalled15Day = clients.filter(
    (c) => c.lastCallNote === null && isNearingExpiryUncalled(c.firstSaleDate, now)
  );

  const weekRange = currentWeekRange(now);
  const trendRanges = recentWeekRanges(TREND_WEEKS, now);
  const trendCounts = await Promise.all(
    trendRanges.map((r) => countBookClientsCreatedInRange(r.start, r.end))
  );
  const weeklyBookCount = trendCounts[trendCounts.length - 1];
  const trendWeeks = trendRanges.map((r, i) => ({
    label: r.label.split(" – ")[0],
    count: trendCounts[i],
    isCurrent: i === trendRanges.length - 1,
  }));

  const missedClientCallbacks = findMissedCallbacks(clients, now);
  const missedBookCallbacks = findMissedCallbacks(bookClients, now);

  const overdueRows: OverdueRow[] = [
    ...missedClientCallbacks.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      href: `/clients/${c.id}`,
      status: c.status,
      reasonLabel: `Missed callback — was ${formatCallbackTime(c.callbackScheduledAt)}`,
    })),
    ...missedBookCallbacks.map((c) => ({
      id: c.id,
      name: [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed",
      phone: c.phone ?? "—",
      href: `/book/${c.id}`,
      status: c.status,
      reasonLabel: `Missed callback — was ${formatCallbackTime(c.callbackScheduledAt)}`,
    })),
  ];

  const today = localDateString(now);
  const todayStart = `${today}T00:00`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const todayEnd = `${localDateString(tomorrow)}T00:00`;
  const todaysBookCallbacks = await listScheduledBookCallbacks(todayStart, todayEnd);

  const reminders = await listActiveReminders();
  const notes = await listNotes();
  const overdueReminders = reminders.filter((r) => r.dueAt && r.dueAt < today);

  // Tier 0 — 50% expiring soon: window closes today, or (window-closing + callback both today).
  const expiringSoonRows: BuildRow[] = [
    ...todaysWindowAndCallbacks
      .filter((row) => row.reason === "window-closing" || row.reason === "both")
      .map((row) => ({
        id: row.client.id,
        name: row.client.name,
        phone: row.client.phone,
        href: `/clients/${row.client.id}`,
        status: row.client.status,
        reasonLabel:
          row.reason === "both" && row.callbackScheduledAt
            ? `Last day — callback at ${formatTimeOnly(row.callbackScheduledAt)}`
            : "Window closes today",
        sortKey: row.callbackScheduledAt ?? "",
        tier: 0,
        kind: "client" as const,
        muted: false,
      })),
    ...neverCalled15Day.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      href: `/clients/${c.id}`,
      status: c.status,
      reasonLabel: `Never called — ${daysLeftInWindow(c.firstSaleDate, now)} day${daysLeftInWindow(c.firstSaleDate, now) === 1 ? "" : "s"} left`,
      sortKey: "",
      tier: 0,
      kind: "client" as const,
      muted: false,
    })),
  ];

  // Tier 1 — callbacks scheduled for today (15-day clients and book clients alike).
  const callbackTodayRows: BuildRow[] = [
    ...todaysWindowAndCallbacks
      .filter((row) => row.reason === "callback")
      .map((row) => ({
        id: row.client.id,
        name: row.client.name,
        phone: row.client.phone,
        href: `/clients/${row.client.id}`,
        status: row.client.status,
        reasonLabel: row.callbackScheduledAt ? `Callback at ${formatTimeOnly(row.callbackScheduledAt)}` : "",
        sortKey: row.callbackScheduledAt ?? "",
        tier: 1,
        kind: "client" as const,
        muted: false,
      })),
    ...todaysBookCallbacks.map((cb) => ({
      id: cb.bookClientId,
      name: cb.clientName,
      phone: cb.clientPhone ?? "—",
      href: `/book/${cb.bookClientId}`,
      status: "CALLBACK" as ClientStatus,
      reasonLabel: `Callback at ${formatTimeOnly(cb.scheduledAt)}`,
      sortKey: cb.scheduledAt,
      tier: 1,
      kind: "book" as const,
      muted: false,
    })),
  ];

  // Tier 2 — shipments with an actual call due right now (shipped or delivered, not yet called about).
  const shipmentRows: BuildRow[] = shipmentsNeedingCall.map((s) => {
    const type: "shipped" | "delivered" = s.shippedCallDone ? "delivered" : "shipped";
    return {
      id: s.id,
      name: s.clientName,
      phone: s.clientPhone ?? "—",
      href: `/book/${s.bookClientId}`,
      status: s.clientStatus,
      reasonLabel: type === "shipped" ? "Shipped — call to confirm" : "Delivered — call to confirm",
      sortKey: "",
      tier: 2,
      kind: "book" as const,
      muted: false,
      shipmentAction: { shipmentId: s.id, bookClientId: s.bookClientId, type },
    };
  });

  const dueTodayRows: BuildRow[] = [...expiringSoonRows, ...callbackTodayRows, ...shipmentRows];

  // Tier 3 — active promo push, not yet called, biggest clients first — only enough to round
  // the list toward the daily target (a promo push shouldn't itself blow past the target).
  const dueTodayIds = new Set(dueTodayRows.map((r) => r.id));
  const promoFillCount = Math.max(0, DAILY_QUEUE_TARGET - dueTodayRows.length);
  const promoRows: BuildRow[] = activePromotion
    ? promoTargets
        .filter((c) => !dueTodayIds.has(c.id))
        .slice(0, promoFillCount)
        .map((c) => ({
          id: c.id,
          name: [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed",
          phone: c.phone ?? "—",
          href: `/book/${c.id}`,
          status: c.status,
          reasonLabel: `Promo — ${activePromotion.name}`,
          sortKey: "",
          tier: 3,
          kind: "book" as const,
          muted: false,
        }))
    : [];
  for (const r of promoRows) dueTodayIds.add(r.id);

  // Tier 4 — backlog fill, only enough to round the list out to the daily target.
  const backlogFillCount = Math.max(0, DAILY_QUEUE_TARGET - dueTodayRows.length - promoRows.length);
  const backlogRows: BuildRow[] = workQueue
    .filter((e) => !dueTodayIds.has(e.client.id))
    .slice(0, backlogFillCount)
    .map((e) => ({
      id: e.client.id,
      name: [e.client.firstName, e.client.lastName].filter(Boolean).join(" ") || "Unnamed",
      phone: e.client.phone ?? "—",
      href: `/book/${e.client.id}`,
      status: e.client.status,
      reasonLabel:
        e.kind === "dormant"
          ? `Backlog — cold ${daysSince(e.client.lastContactAt as string, now)} days`
          : "Backlog — never contacted",
      sortKey: "",
      tier: 4,
      kind: "book" as const,
      muted: true,
    }));

  const priorityRows: PriorityRowData[] = [...dueTodayRows, ...promoRows, ...backlogRows]
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return a.sortKey && b.sortKey ? a.sortKey.localeCompare(b.sortKey) : a.name.localeCompare(b.name);
    })
    .map(({ sortKey: _sortKey, tier: _tier, ...row }) => row);

  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01T00:00`;
  const nextMonthDate = new Date(year, month + 1, 1);
  const monthEnd = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}-01T00:00`;
  const [clientCallbacks, bookCallbacks] = await Promise.all([
    listScheduledCallbacks(monthStart, monthEnd),
    listScheduledBookCallbacks(monthStart, monthEnd),
  ]);

  const callbacksByDay: Record<string, CalendarCallback[]> = {};
  for (const cb of clientCallbacks) {
    const day = cb.scheduledAt.slice(0, 10);
    (callbacksByDay[day] ??= []).push({
      id: cb.clientId,
      name: cb.clientName,
      time: formatTimeOnly(cb.scheduledAt),
      href: `/clients/${cb.clientId}`,
    });
  }
  for (const cb of bookCallbacks) {
    const day = cb.scheduledAt.slice(0, 10);
    (callbacksByDay[day] ??= []).push({
      id: cb.bookClientId,
      name: cb.clientName,
      time: formatTimeOnly(cb.scheduledAt),
      href: `/book/${cb.bookClientId}`,
    });
  }

  const prevMonthDate = new Date(year, month - 1, 1);
  const nextMonthHref = `/?month=${monthParam(nextMonthDate.getFullYear(), nextMonthDate.getMonth())}`;
  const prevMonthHref = `/?month=${monthParam(prevMonthDate.getFullYear(), prevMonthDate.getMonth())}`;

  const weeklyPct = Math.min(100, Math.round((weeklyBookCount / WEEKLY_GOAL) * 100));
  const weeklyRemaining = Math.max(0, WEEKLY_GOAL - weeklyBookCount);
  const workdaysLeft = remainingWorkdays(now, weekRange.end);
  const paceLabel =
    weeklyRemaining === 0
      ? "Goal hit for the week."
      : workdaysLeft === 0
        ? `${weeklyRemaining} short of goal with no workdays left this week.`
        : `Need ${weeklyRemaining} more by Wed — about ${Math.ceil(weeklyRemaining / workdaysLeft)}/day.`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Today: {formatDate(new Date().toISOString())}
          </p>
        </div>
        <Link
          href="/book/new"
          className="rounded bg-gold px-4 py-2 text-sm font-medium text-brand-black transition-opacity hover:opacity-90"
        >
          + Log New Account
        </Link>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold text-foreground">Weekly Goal</h2>
          <span className="text-xs text-muted-foreground">{weekRange.label}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          New book clients this week — direct sales and 50% conversions both count.
        </p>
        <div className="mt-3 flex items-center gap-4">
          <p className="text-2xl font-semibold text-gold">
            {weeklyBookCount}
            <span className="text-sm font-normal text-muted-foreground"> / {WEEKLY_GOAL}</span>
          </p>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-background">
            <div className="h-full rounded-full bg-gold" style={{ width: `${weeklyPct}%` }} />
          </div>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{paceLabel}</p>
        <WeeklyTrendChart weeks={trendWeeks} goal={WEEKLY_GOAL} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-display text-lg font-semibold text-foreground">Whale Tracker</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Goal: {WHALE_GOAL_COUNT} clients at $50k+ — a {formatWholeCurrency(WHALE_GOAL_VALUE)} book.
          </p>
          <div className="mt-3 flex items-center gap-4">
            <p className="text-2xl font-semibold text-gold">
              {valueStats.whaleCount}
              <span className="text-sm font-normal text-muted-foreground"> / {WHALE_GOAL_COUNT} Whales</span>
            </p>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-background">
              <div
                className="h-full rounded-full bg-gold"
                style={{ width: `${Math.min(100, Math.round((valueStats.whaleCount / WHALE_GOAL_COUNT) * 100))}%` }}
              />
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatWholeCurrency(valueStats.totalValue)} tracked of {formatWholeCurrency(WHALE_GOAL_VALUE)} goal.
          </p>
        </div>

        {activePromotion && promotionProgress ? (
          <Link
            href="/promotions"
            className="block rounded-lg border border-gold/40 bg-card p-5 transition-[border-color,box-shadow] hover:shadow-sm"
          >
            <h2 className="font-display text-lg font-semibold text-foreground">Active Promotion</h2>
            <p className="mt-1 text-sm text-muted-foreground">{activePromotion.name}</p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <span className="text-gold">{promotionProgress.emailedCount} emailed</span>
              <span className="text-gold">{promotionProgress.textedCount} texted</span>
              <span className="text-gold">{promotionProgress.calledCount} called</span>
              <span className="text-muted-foreground">of {promotionProgress.totalClients}</span>
            </div>
          </Link>
        ) : (
          <Link
            href="/promotions"
            className="flex flex-col justify-center rounded-lg border border-dashed border-border bg-card p-5 text-center transition-colors hover:border-gold"
          >
            <span className="text-sm text-muted-foreground">No active promotion — start one</span>
          </Link>
        )}
      </div>

      {(overdueRows.length > 0 || overdueReminders.length > 0) && (
        <div className="rounded-lg border border-red-600/40 bg-card p-5 dark:border-red-400/40">
          <h2 className="font-display text-lg font-semibold text-red-600 dark:text-red-400">
            Overdue
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Callbacks that passed without a call, and reminders you set that came due.
          </p>
          <ul className="mt-3 divide-y divide-border">
            {overdueRows.map((row) => (
              <li key={`${row.href}-${row.reasonLabel}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link
                  href={row.href}
                  className="font-medium text-foreground hover:text-gold hover:underline"
                >
                  {row.name}
                </Link>
                <span className="text-muted-foreground">
                  <PhoneLink phone={row.phone} />
                </span>
                <span className="text-red-600 dark:text-red-400">{row.reasonLabel}</span>
              </li>
            ))}
            {overdueReminders.map((r) => (
              <ReminderItem key={r.id} id={r.id} text={r.text} dueAt={r.dueAt} overdue />
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="font-display text-lg font-semibold text-foreground">Today&apos;s Priority</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your call list for the day, top to bottom — 50% clients expiring soon, then callbacks
          scheduled for today, then shipments needing a call, filled out from your backlog so
          there&apos;s always {DAILY_QUEUE_TARGET} to work.
        </p>
        <div className="mt-4">
          {priorityRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing due, and your backlog is clear. Great spot to be in.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-background text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Client</th>
                      <th className="px-4 py-2">Phone</th>
                      <th className="px-4 py-2">Why Today</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {priorityRows.map((row) => (
                      <PriorityRowItem key={row.href} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
              {(promoRows.length > 0 || backlogRows.length > 0) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {promoRows.length > 0 && (
                    <>
                      {promoRows.length} from the active{" "}
                      <Link href="/promotions" className="underline hover:text-gold">
                        promotion
                      </Link>
                      {backlogRows.length > 0 && ", "}
                    </>
                  )}
                  {backlogRows.length > 0 && (
                    <>
                      {backlogRows.length} pulled from your{" "}
                      <Link href="/reactivate" className="underline hover:text-gold">
                        backlog
                      </Link>
                    </>
                  )}{" "}
                  to round out today.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div>
        <MonthCalendar
          year={year}
          month={month}
          todayDate={localDateString(now)}
          callbacksByDay={callbacksByDay}
          prevHref={prevMonthHref}
          nextHref={nextMonthHref}
        />
      </div>

      <div>
        <h2 className="font-display text-lg font-semibold text-foreground">Shipments</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Personal client orders that have shipped, waiting on your shipped/delivered calls.
          Drops off once both calls are checked off.
        </p>
        <div className="mt-4">
          {activeShipments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No shipments in progress.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-background text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Client</th>
                    <th className="px-4 py-2">Phone</th>
                    <th className="px-4 py-2">Tracking</th>
                    <th className="px-4 py-2">Shipped</th>
                    <th className="px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {activeShipments.map((s) => (
                    <tr key={s.id} className="hover:bg-gold/5">
                      <td className="px-4 py-3">
                        <Link
                          href={`/book/${s.bookClientId}`}
                          className="font-medium text-foreground hover:text-gold hover:underline"
                        >
                          {s.clientName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <PhoneLink phone={s.clientPhone} />
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        <TrackingLink carrier={s.carrier} trackingLink={s.trackingLink} />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(s.shippedAt)}
                        {s.deliveredAt && (
                          <div className="text-xs">Delivered {formatDate(s.deliveredAt)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ShipmentActions
                          shipmentId={s.id}
                          bookClientId={s.bookClientId}
                          shippedCallDone={s.shippedCallDone}
                          deliveredAt={s.deliveredAt}
                          deliveredCallDone={s.deliveredCallDone}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-display text-lg font-semibold text-foreground">Reminders</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Anything you need to remember — check it off when it&apos;s done.
          </p>
          <form action={createReminderAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input
              name="text"
              type="text"
              placeholder="e.g. Call the coin show organizer"
              required
              className="min-w-[10rem] flex-1 rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
            />
            <input
              name="dueDate"
              type="date"
              className="rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
            />
            <button
              type="submit"
              className="rounded bg-gold px-3 py-2 text-sm font-medium text-brand-black transition-opacity hover:opacity-90"
            >
              Add
            </button>
          </form>
          {reminders.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No reminders set.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {reminders.map((r) => (
                <ReminderItem
                  key={r.id}
                  id={r.id}
                  text={r.text}
                  dueAt={r.dueAt}
                  overdue={!!r.dueAt && r.dueAt < today}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-display text-lg font-semibold text-foreground">Notes</h2>
          <p className="mt-1 text-sm text-muted-foreground">Quick scratchpad — jot anything down.</p>
          <form action={createNoteAction} className="mt-3 space-y-2">
            <textarea
              name="text"
              rows={2}
              placeholder="Type a note..."
              required
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
            />
            <button
              type="submit"
              className="rounded bg-gold px-3 py-2 text-sm font-medium text-brand-black transition-opacity hover:opacity-90"
            >
              Add Note
            </button>
          </form>
          {notes.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No notes yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {notes.map((n) => (
                <NoteItem key={n.id} id={n.id} text={n.text} createdAt={n.createdAt} />
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link
          href="/follow-up"
          className="block rounded-lg border border-border bg-card p-5 transition-[border-color,box-shadow] hover:border-gold hover:shadow-sm"
        >
          <h2 className="font-display text-lg font-semibold text-foreground">50% Follow-Up</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            New clients still inside their 15-day, 50%-commission window.
          </p>
          <p className="mt-3 text-2xl font-semibold text-gold">
            {sections.priority.length}{" "}
            <span className="text-sm font-normal text-muted-foreground">need attention today</span>
          </p>
        </Link>

        <Link
          href="/book"
          className="block rounded-lg border border-border bg-card p-5 transition-[border-color,box-shadow] hover:border-gold hover:shadow-sm"
        >
          <h2 className="font-display text-lg font-semibold text-foreground">Clients</h2>
          <p className="mt-1 text-sm text-muted-foreground">Your full existing client book.</p>
          <p className="mt-3 text-2xl font-semibold text-gold">
            {bookCount} <span className="text-sm font-normal text-muted-foreground">clients</span>
          </p>
        </Link>

        <Link
          href="/reactivate"
          className="block rounded-lg border border-border bg-card p-5 transition-[border-color,box-shadow] hover:border-gold hover:shadow-sm"
        >
          <h2 className="font-display text-lg font-semibold text-foreground">Work the Book</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Gone cold ({DORMANT_DAYS}+ days) or never contacted at all.
          </p>
          <p className="mt-3 text-2xl font-semibold text-gold">
            {workQueue.length} <span className="text-sm font-normal text-muted-foreground">to work</span>
          </p>
        </Link>
      </div>
    </div>
  );
}
