import Link from "next/link";
import { listClientsWithLastCallNote, listScheduledCallbacks } from "@/lib/clients";
import {
  listBookClientsWithLastContact,
  listScheduledBookCallbacks,
  countBookClientsCreatedInRange,
  getBookValueStats,
} from "@/lib/book";
import { listActiveShipments } from "@/lib/shipments";
import { listActiveReminders } from "@/lib/reminders";
import { listNotes } from "@/lib/notes";
import {
  listActivePromotions,
  getPromotionProgress,
  type Promotion,
  type PromotionProgress,
} from "@/lib/promotions";
import {
  buildFollowUpSections,
  buildWorkTheBookQueue,
  currentWeekRange,
  DORMANT_DAYS,
  localDateString,
  nowET,
  remainingWorkdays,
  VALUE_TIER_THRESHOLDS,
  WEEKLY_GOAL,
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
import { ensurePartyForBook } from "@/lib/followup/store";

export const dynamic = "force-dynamic";

function monthParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function CampaignCard({ promo, progress }: { promo: Promotion; progress: PromotionProgress }) {
  const href = "/campaigns";
  const label = promo.kind === "COIN_OF_WEEK" ? "Coin of the Week" : "Active Promotion";
  return (
    <Link
      href={href}
      className="block rounded-lg border border-gold/40 bg-card p-5 transition-[border-color,box-shadow] hover:shadow-sm"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-lg font-semibold text-foreground">{promo.name}</p>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <span className="text-gold">{progress.emailedCount} emailed</span>
        <span className="text-gold">{progress.textedCount} texted</span>
        <span className="text-gold">{progress.calledCount} called</span>
        <span className="text-muted-foreground">of {progress.totalClients}</span>
      </div>
    </Link>
  );
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
  const bookCount = bookClients.length;
  const activeShipments = await listActiveShipments();

  const workQueue = buildWorkTheBookQueue(bookClients, now);

  const activePromotions = await listActivePromotions();
  const [campaignCards, valueStats] = await Promise.all([
    Promise.all(
      activePromotions.map(async (p) => ({
        promo: p,
        progress: await getPromotionProgress(p.id),
      }))
    ),
    getBookValueStats(VALUE_TIER_THRESHOLDS.whale),
  ]);

  const weekRange = currentWeekRange(now);
  const weeklyBookCount = await countBookClientsCreatedInRange(weekRange.start, weekRange.end);

  // Daily trend for now — the book is young, so weekly bars hid the day-to-day movement.
  const TREND_DAYS = 14;
  const dayRanges = Array.from({ length: TREND_DAYS }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (TREND_DAYS - 1 - i));
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    return {
      start: `${localDateString(d)}T00:00:00`,
      end: `${localDateString(next)}T00:00:00`,
      label:
        i === TREND_DAYS - 1
          ? "Today"
          : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      range: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      isCurrent: i === TREND_DAYS - 1,
    };
  });
  const dayCounts = await Promise.all(
    dayRanges.map((r) => countBookClientsCreatedInRange(r.start, r.end))
  );
  const trendPoints = dayRanges.map((r, i) => ({
    label: r.label,
    range: r.range,
    count: dayCounts[i],
    isCurrent: r.isCurrent,
  }));
  const dailyPace = Math.ceil(WEEKLY_GOAL / 5);

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

  const weeklyPct = Math.min(100, Math.round((weeklyBookCount / WEEKLY_GOAL) * 100));
  const weeklyRemaining = Math.max(0, WEEKLY_GOAL - weeklyBookCount);
  const workdaysLeft = remainingWorkdays(now, weekRange.end);
  const paceLabel =
    weeklyRemaining === 0
      ? "Goal hit for the week."
      : workdaysLeft === 0
        ? `${weeklyRemaining} short of goal with no workdays left this week.`
        : `Need ${weeklyRemaining} more by Wed — about ${Math.ceil(weeklyRemaining / workdaysLeft)}/day.`;

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
        <WeeklyTrendChart
          points={trendPoints}
          goal={dailyPace}
          goalLabel={`Daily new-client trend, pace ${dailyPace}/day`}
          caption={`Dashed line = daily pace (${dailyPace}/day hits the weekly ${WEEKLY_GOAL} across Mon–Fri). Last ${14} days, today highlighted.`}
        />
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

        {campaignCards.length > 0 ? (
          <div className="grid grid-cols-1 gap-4">
            {campaignCards.map(({ promo, progress }) => (
              <CampaignCard key={promo.id} promo={promo} progress={progress} />
            ))}
          </div>
        ) : (
          <Link
            href="/campaigns"
            className="flex flex-col justify-center rounded-lg border border-dashed border-border bg-card p-5 text-center transition-colors hover:border-gold"
          >
            <span className="text-sm text-muted-foreground">No active campaign — start a promotion</span>
          </Link>
        )}
      </div>

      <div>
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
        <p className="mt-1 text-sm text-muted-foreground">
          Work it top to bottom: promised callbacks, delivery check-ins, shipment/service issues, then the
          30-day follow-ups (50% window first), then any reactivation clients you selected.
        </p>
        <div className="mt-4">
          <DailyQueue queue={queue} basePath="/" />
        </div>
      </div>

      {overdueReminders.length > 0 && (
        <div className="rounded-lg border border-red-600/40 bg-card p-5 dark:border-red-400/40">
          <h2 className="font-display text-lg font-semibold text-red-600 dark:text-red-400">Overdue reminders</h2>
          <ul className="mt-3 divide-y divide-border">
            {overdueReminders.map((r) => (
              <ReminderItem key={r.id} id={r.id} text={r.text} dueAt={r.dueAt} overdue />
            ))}
          </ul>
        </div>
      )}

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
          <h2 className="font-display text-lg font-semibold text-foreground">Reactivation</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Clients whose 30-day cycle ended, plus the cold book ({DORMANT_DAYS}+ days). You choose who to work.
          </p>
          <p className="mt-3 text-2xl font-semibold text-gold">
            {workQueue.length} <span className="text-sm font-normal text-muted-foreground">cold in the book</span>
          </p>
        </Link>
      </div>
    </div>
  );
}
