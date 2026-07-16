import Link from "next/link";
import { listClientsWithLastCallNote, listScheduledCallbacks } from "@/lib/clients";
import { listBookClients, listScheduledBookCallbacks } from "@/lib/book";
import { listActiveShipments } from "@/lib/shipments";
import { buildFollowUpSections, buildTodaysPriority, localDateString } from "@/lib/business-logic";
import { formatDate, formatTimeOnly } from "@/lib/format";
import type { ClientStatus } from "@/lib/types";
import StatusBadge from "@/components/StatusBadge";
import MonthCalendar, { type CalendarCallback } from "@/components/MonthCalendar";
import ShipmentActions from "@/components/ShipmentActions";

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
  const bookCount = (await listBookClients()).length;
  const todaysWindowAndCallbacks = buildTodaysPriority(clients, now);
  const activeShipments = await listActiveShipments();

  const today = localDateString(now);
  const todayStart = `${today}T00:00`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const todayEnd = `${localDateString(tomorrow)}T00:00`;
  const todaysBookCallbacks = await listScheduledBookCallbacks(todayStart, todayEnd);

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Today: {formatDate(new Date().toISOString())}
        </p>
      </div>

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
    </div>
  );
}
