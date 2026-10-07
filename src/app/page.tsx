import Link from "next/link";
import { listClientsWithLastCallNote, listScheduledCallbacks } from "@/lib/clients";
import {
  listBookClientsWithLastContact,
  listScheduledBookCallbacks,
  getBookValueStats,
} from "@/lib/book";
import { listActiveShipments } from "@/lib/shipments";
import { listActiveReminders } from "@/lib/reminders";
import { listNotes } from "@/lib/notes";
import {
  buildFollowUpSections,
  buildWorkTheBookQueue,
  localDateString,
  nowET,
  VALUE_TIER_THRESHOLDS,
  WHALE_GOAL_COUNT,
  WHALE_GOAL_VALUE,
} from "@/lib/business-logic";
import { formatDate, formatTimeOnly, formatWholeCurrency } from "@/lib/format";
import MonthCalendar, { type CalendarCallback } from "@/components/MonthCalendar";
import ShipmentActions from "@/components/ShipmentActions";
import ReminderItem from "@/components/ReminderItem";
import NoteItem from "@/components/NoteItem";
import WeeklyTrendChart from "@/components/WeeklyTrendChart";
import PhoneLink from "@/components/PhoneLink";
import TrackingLink from "@/components/TrackingLink";
import DailyQueue from "@/components/DailyQueue";
import { createReminderAction, createNoteAction } from "@/app/actions";
import { getDailyQueue, getExceptions } from "@/lib/followup/queue";
import { reconcile } from "@/lib/followup/reconcile";
import { getSalesStats } from "@/lib/followup/sales-stats";
import { ensurePartyForBook } from "@/lib/followup/store";

export const dynamic = "force-dynamic";

function monthParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; qp?: string }>;
}) {
  const { month: monthParamValue, qp } = await searchParams;
  const now = nowET();
  const instant = new Date();

  let year = now.getFullYear();
  let month = now.getMonth();
  if (monthParamValue && /^\d{4}-\d{2}$/.test(monthParamValue)) {
    const [y, m] = monthParamValue.split("-").map(Number);
    year = y;
    month = m - 1;
  }

  // Housekeeping first (idempotent): roll up missed steps, close ended cycles, import callbacks.
  await reconcile(instant);
  const [queue, exceptions] = await Promise.all([
    getDailyQueue(instant, { page: Number(qp) || 1 }),
    getExceptions(instant),
  ]);
  const exceptionCount =
    exceptions.noNextAction.length +
    exceptions.overdueCallbacks.length +
    exceptions.missedSteps.length +
    exceptions.unconfirmedDeliveries.length;

  const clients = await listClientsWithLastCallNote();
  const sections = buildFollowUpSections(clients);
  const bookClients = await listBookClientsWithLastContact();
  const activeShipments = await listActiveShipments();

  const workQueue = buildWorkTheBookQueue(bookClients, now);

  const valueStats = await getBookValueStats(VALUE_TIER_THRESHOLDS.whale);

  const sales = await getSalesStats(instant);
  const trendPoints = sales.trend.map((t, i) => ({
    label: i === sales.trend.length - 1 ? "Today" : new Date(`${t.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    range: new Date(`${t.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }),
    count: t.count,
    isCurrent: i === sales.trend.length - 1,
  }));

  const today = localDateString(now);
  const reminders = await listActiveReminders();
  const notes = await listNotes();
  // Client-linked reminders predate the persistent task system; only freestanding ones are shown.
  const overdueReminders = reminders.filter((r) => r.dueAt && r.dueAt < today && !r.bookClientId);

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
      sortKey: cb.scheduledAt,
      href: `/clients/${cb.clientId}`,
    });
  }
  for (const cb of bookCallbacks) {
    const day = cb.scheduledAt.slice(0, 10);
    (callbacksByDay[day] ??= []).push({
      id: cb.bookClientId,
      name: cb.clientName,
      time: formatTimeOnly(cb.scheduledAt),
      sortKey: cb.scheduledAt,
      href: `/book/${cb.bookClientId}`,
    });
  }
  for (const day of Object.keys(callbacksByDay)) {
    callbacksByDay[day].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }

  const prevMonthDate = new Date(year, month - 1, 1);
  const nextMonthHref = `/?month=${monthParam(nextMonthDate.getFullYear(), nextMonthDate.getMonth())}`;
  const prevMonthHref = `/?month=${monthParam(prevMonthDate.getFullYear(), prevMonthDate.getMonth())}`;

  const todayPct = Math.min(100, Math.round((sales.todayCount / sales.dailyGoal) * 100));
  const monthPct = Math.min(100, Math.round((sales.monthCount / sales.monthlyGoal) * 100));
  const paceLabel =
    sales.monthCount >= sales.monthlyGoal
      ? "Monthly goal hit."
      : `Need ${sales.monthlyGoal - sales.monthCount} more this month — about ${sales.neededPerDay}/working day.`;

  // Shipments still in progress: not delivered, or delivered but receipt not confirmed, or an open issue.
  const shipmentRows = await Promise.all(
    activeShipments.map(async (s) => ({ s, partyId: s.partyId ?? (await ensurePartyForBook(s.bookClientId)) }))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Today: {formatDate(localDateString(now))}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/clients/new"
            className="rounded bg-gold px-4 py-2 text-sm font-medium text-brand-black transition-opacity hover:opacity-90"
          >
            + New Account (50% List)
          </Link>
          <Link
            href="/book/new"
            className="rounded border border-gold px-4 py-2 text-sm font-medium text-gold transition-colors hover:bg-gold/10"
          >
            + Add Client to Book
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Sales today</p>
          <div className="mt-1 flex items-center gap-3">
            <p className="text-xl font-semibold text-gold">{sales.todayCount}<span className="text-sm font-normal text-muted-foreground"> / {sales.dailyGoal}</span></p>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-gold" style={{ width: `${todayPct}%` }} /></div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{sales.monthCount} of {sales.monthlyGoal} this month · {paceLabel}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Whale Tracker</p>
          <div className="mt-1 flex items-center gap-3">
            <p className="text-xl font-semibold text-gold">{valueStats.whaleCount}<span className="text-sm font-normal text-muted-foreground"> / {WHALE_GOAL_COUNT}</span></p>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(100, Math.round((valueStats.whaleCount / WHALE_GOAL_COUNT) * 100))}%` }} /></div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{formatWholeCurrency(valueStats.totalValue)} of {formatWholeCurrency(WHALE_GOAL_VALUE)}</p>
        </div>
      </div>

      <div id="queue" className="scroll-mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-foreground">Today&apos;s Queue</h2>
          <Link
            href="/queue/exceptions"
            className={
              exceptionCount > 0
                ? "rounded border border-red-500/50 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-500/10 dark:text-red-400"
                : "rounded border border-border px-3 py-1 text-sm text-muted-foreground hover:border-gold"
            }
          >
            {exceptionCount > 0 ? `${exceptionCount} exception${exceptionCount === 1 ? "" : "s"} →` : "No exceptions"}
          </Link>
        </div>
        <div className="mt-4">
          <DailyQueue queue={queue} basePath="/" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div id="reminders" className="scroll-mt-4 rounded-lg border border-border bg-card p-5">
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
            <input
              name="dueTime"
              type="time"
              title="Optional time (Eastern) — alerts you in the app at that time"
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
                  dueTime={r.dueTime}
                  overdue={!!r.dueAt && r.dueAt < today}
                />
              ))}
            </ul>
          )}
        </div>

        <div id="notes" className="scroll-mt-4 rounded-lg border border-border bg-card p-5">
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
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Remind me (optional):</span>
              <input name="remindDate" type="date" className="rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-gold focus:outline-none" />
              <input name="remindTime" type="time" className="rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-gold focus:outline-none" />
            </div>
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
                <NoteItem key={n.id} id={n.id} text={n.text} createdAt={n.createdAt} remindDate={n.remindDate} remindTime={n.remindTime} remindDone={n.remindDone} />
              ))}
            </ul>
          )}
        </div>
      </div>

      {overdueReminders.length > 0 && (
        <div className="rounded-lg border border-red-600/40 bg-card p-5 dark:border-red-400/40">
          <h2 className="font-display text-lg font-semibold text-red-600 dark:text-red-400">Overdue reminders</h2>
          <ul className="mt-3 divide-y divide-border">
            {overdueReminders.map((r) => (
              <ReminderItem key={r.id} id={r.id} text={r.text} dueAt={r.dueAt} dueTime={r.dueTime} overdue />
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="font-display text-lg font-semibold text-foreground">Shipments</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Orders in transit, delivered-but-unconfirmed, or with an open issue. A shipment leaves this list only when
          the client confirms receipt — an unanswered call never clears it.
        </p>
        <div className="mt-4">
          {shipmentRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No shipments in progress.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-background text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Client</th>
                    <th className="px-4 py-2">Phone</th>
                    <th className="px-4 py-2">Tracking</th>
                    <th className="px-4 py-2">Shipped / expected</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shipmentRows.map(({ s, partyId }) => (
                    <tr key={s.id} className="align-top hover:bg-gold/5">
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
                        {s.expectedDelivery && !s.deliveredAt && (
                          <div className="text-xs">Est. delivery {formatDate(s.expectedDelivery)} (estimate)</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {partyId && (
                          <ShipmentActions
                            shipmentId={s.id}
                            partyId={partyId}
                            name={s.clientName}
                            deliveredDate={s.deliveredDate ?? (s.deliveredAt ? s.deliveredAt.slice(0, 10) : null)}
                            receiptConfirmed={!!s.receiptConfirmedAt}
                            openIssue={s.exception && !s.exceptionResolvedAt ? s.exception : null}
                            profilePath={`/book/${s.bookClientId}`}
                            expectedDelivery={s.expectedDelivery}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

      <details className="rounded-lg border border-border bg-card p-4">
        <summary className="cursor-pointer font-display text-base font-semibold text-foreground">Sales trend — {sales.monthLabel}</summary>
        <div className="mt-3">
          <div className="flex items-center gap-4">
            <p className="text-2xl font-semibold text-gold">
              {sales.monthCount}
              <span className="text-sm font-normal text-muted-foreground"> / {sales.monthlyGoal} this month</span>
            </p>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-background">
              <div className="h-full rounded-full bg-gold" style={{ width: `${monthPct}%` }} />
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{paceLabel}</p>
          <WeeklyTrendChart
            points={trendPoints}
            goal={sales.dailyGoal}
            goalLabel={`Daily sales, goal ${sales.dailyGoal}/day`}
            caption={`Dashed line = daily goal (${sales.dailyGoal}/day). Every sale you record counts. Last 14 days, today highlighted.`}
          />
        </div>
      </details>

      <p className="text-sm text-muted-foreground">
        <Link href="/reactivate" className="text-gold hover:underline">Reactivation ({workQueue.length} cold in the book)</Link> ·{" "}
        <Link href="/follow-up" className="text-gold hover:underline">50% Follow-Up ({sections.priority.length} need attention)</Link> ·{" "}
        <Link href="/reports" className="text-gold hover:underline">Reports</Link>
      </p>
    </div>
  );
}
