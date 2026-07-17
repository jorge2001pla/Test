import Link from "next/link";
import { listClientsWithLastCallNote, listScheduledCallbacks } from "@/lib/clients";
import {
  listBookClientsWithLastContact,
  listScheduledBookCallbacks,
  countBookClientsCreatedInRange,
} from "@/lib/book";
import { listActiveShipments } from "@/lib/shipments";
import { listActiveReminders } from "@/lib/reminders";
import { listNotes } from "@/lib/notes";
import {
  buildFollowUpSections,
  buildTodaysPriority,
  currentWeekRange,
  DORMANT_DAYS,
  daysSince,
  findMissedCallbacks,
  isWithinNeverCalledWindow,
  localDateString,
  WEEKLY_GOAL,
} from "@/lib/business-logic";
import { formatCallbackTime, formatDate, formatTimeOnly } from "@/lib/format";
import type { ClientStatus } from "@/lib/types";
import StatusBadge from "@/components/StatusBadge";
import MonthCalendar, { type CalendarCallback } from "@/components/MonthCalendar";
import ShipmentActions from "@/components/ShipmentActions";
import ReminderItem from "@/components/ReminderItem";
import NoteItem from "@/components/NoteItem";
import { createReminderAction, createNoteAction } from "@/app/actions";

export const dynamic = "force-dynamic";

function monthParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

interface PriorityRow {
  id: string;
  name: string;
  phone: string;
  href: string;
  status: ClientStatus;
  reasonLabel: string;
  sortKey: string;
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

  const dormantCount = bookClients.filter(
    (c) => c.status !== "NOT_INTERESTED" && c.lastContactAt !== null && daysSince(c.lastContactAt, now) >= DORMANT_DAYS
  ).length;

  const neverCalled15Day = clients.filter(
    (c) => c.lastCallNote === null && isWithinNeverCalledWindow(c.firstSaleDate, now)
  );
  const neverCalledBook = bookClients.filter(
    (c) => c.source === "manual" && c.lastContactAt === null && isWithinNeverCalledWindow(c.createdAt, now)
  );

  const weekRange = currentWeekRange(now);
  const weeklyBookCount = await countBookClientsCreatedInRange(weekRange.start, weekRange.end);

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

  const priorityRows: PriorityRow[] = [
    ...todaysWindowAndCallbacks.map((row) => ({
      id: row.client.id,
      name: row.client.name,
      phone: row.client.phone,
      href: `/clients/${row.client.id}`,
      status: row.client.status,
      reasonLabel:
        row.reason === "window-closing"
          ? "Window closes today"
          : row.reason === "callback" && row.callbackScheduledAt
            ? `Callback at ${formatTimeOnly(row.callbackScheduledAt)}`
            : row.reason === "both" && row.callbackScheduledAt
              ? `Last day — callback at ${formatTimeOnly(row.callbackScheduledAt)}`
              : "",
      sortKey: row.callbackScheduledAt ?? "",
    })),
    ...todaysBookCallbacks.map((cb) => ({
      id: cb.bookClientId,
      name: cb.clientName,
      phone: cb.clientPhone ?? "—",
      href: `/book/${cb.bookClientId}`,
      status: "CALLBACK" as ClientStatus,
      reasonLabel: `Callback at ${formatTimeOnly(cb.scheduledAt)}`,
      sortKey: cb.scheduledAt,
    })),
    ...neverCalled15Day.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      href: `/clients/${c.id}`,
      status: c.status,
      reasonLabel: `New lead, never called (day ${daysSince(c.firstSaleDate, now) + 1})`,
      sortKey: "",
    })),
    ...neverCalledBook.map((c) => ({
      id: c.id,
      name: [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed",
      phone: c.phone ?? "—",
      href: `/book/${c.id}`,
      status: c.status,
      reasonLabel: `New lead, never called (day ${daysSince(c.createdAt, now) + 1})`,
      sortKey: "",
    })),
  ].sort((a, b) => (a.sortKey && b.sortKey ? a.sortKey.localeCompare(b.sortKey) : a.name.localeCompare(b.name)));

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
          Windows closing today, and callbacks you scheduled for today — new clients and existing
          book clients alike. This is the place to start every day.
        </p>
        <div className="mt-4">
          {priorityRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing due today. Check the 50% Follow-Up tab for what&apos;s coming up.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-background text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Client</th>
                    <th className="px-4 py-2">Phone</th>
                    <th className="px-4 py-2">Why Today</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {priorityRows.map((row) => (
                    <tr key={row.href} className="hover:bg-gold/5">
                      <td className="px-4 py-3">
                        <Link
                          href={row.href}
                          className="font-medium text-foreground hover:text-gold hover:underline"
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{row.phone}</td>
                      <td className="px-4 py-3 text-foreground">{row.reasonLabel}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} />
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
                      <td className="px-4 py-3 text-muted-foreground">{s.clientPhone ?? "—"}</td>
                      <td className="px-4 py-3 text-foreground">
                        {s.carrier} — {s.trackingNumber}
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
          <h2 className="font-display text-lg font-semibold text-foreground">Reactivate</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Clients you haven&apos;t spoken to in {DORMANT_DAYS}+ days.
          </p>
          <p className="mt-3 text-2xl font-semibold text-gold">
            {dormantCount} <span className="text-sm font-normal text-muted-foreground">dormant</span>
          </p>
        </Link>
      </div>
    </div>
  );
}
