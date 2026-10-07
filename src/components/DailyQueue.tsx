import Link from "next/link";
import LogContactPanel from "@/components/LogContactPanel";
import TaskActions from "@/components/TaskActions";
import TrackingForm from "@/components/TrackingForm";
import TrackingCheck from "@/components/TrackingCheck";
import type { DailyQueue as Queue, QueueRow } from "@/lib/followup/queue";
import { fmtDate, fmtDay, fmtInstant } from "@/lib/followup/present";

function Row({ row }: { row: QueueRow }) {
  const first = row.tasks[0];
  const shipTask = row.tasks.find((t) => t.shipmentId);
  const phones = (row.phone ?? "").split(";").map((x) => x.trim()).filter(Boolean);
  // One quiet status line: only what helps you decide how to work this client right now.
  const facts: React.ReactNode[] = [];
  if (row.cycleDay != null) facts.push(<>Day {Math.min(row.cycleDay, 30)}/30</>);
  if (row.lastAttemptAt) facts.push(<>Last called {fmtDay(row.lastAttemptAt)}</>);
  if (row.lastObjection) facts.push(<>Objection: {row.lastObjection}</>);
  const restrictions = [row.noCalls && "no calls", row.noText && "no texts", row.noEmail && "no email"].filter(Boolean).join(", ");
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <Link href={row.href} className="font-medium text-foreground hover:text-gold hover:underline">
              {row.name}
            </Link>
            <span className="text-sm text-muted-foreground">{phones.join(" · ") || "—"}</span>
            {row.localTime && <span className="text-xs text-muted-foreground">{row.localTime} their time</span>}
          </div>
          <p className="mt-0.5 text-sm text-foreground">
            {row.why}
            {first.overdue && <span className="ml-2 rounded bg-red-500/15 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">overdue</span>}
          </p>
          {(facts.length > 0 || restrictions) && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {facts.map((f, i) => (<span key={i}>{i > 0 && " · "}{f}</span>))}
              {restrictions && <span className="text-orange-700 dark:text-orange-400">{facts.length > 0 ? " · " : ""}{restrictions}</span>}
            </p>
          )}
        </div>
        <LogContactPanel
          partyId={row.partyId}
          name={row.name}
          defaults={{ taskId: first.id, shipmentId: shipTask?.shipmentId ?? null, purpose: first.purpose }}
          showDelivery={row.tasks.some((t) => t.category === "DELIVERY")}
          hasBook={row.href.startsWith("/book/")}
          profilePath={row.href}
        />
      </div>

      <ul className="mt-2 space-y-1.5 border-l-2 border-gold/40 pl-3">
        {row.tasks.map((t) => (
          <li key={t.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <div className="text-sm text-foreground">
              {t.purpose}
              <span className="ml-2 text-xs text-muted-foreground">{t.dueAt ? fmtInstant(t.dueAt) : fmtDate(t.dueDate)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {t.category === "SHIPMENT" && t.type === "TASK" && !t.shipmentId && t.orderId && <TrackingForm orderId={t.orderId} profilePath={row.href} />}
              {t.category === "SHIPMENT" && t.type === "TASK" && t.shipmentId && <TrackingCheck shipmentId={t.shipmentId} trackingLink={t.detail} profilePath={row.href} />}
              <TaskActions taskId={t.id} timed={t.category === "CALLBACK"} />
            </div>
          </li>
        ))}
      </ul>
    </li>
  );
}

export default function DailyQueue({
  queue,
  basePath,
  showPaging = true,
}: {
  queue: Queue;
  basePath: string;
  showPaging?: boolean;
}) {
  const pageHref = (p: number) => `${basePath}${basePath.includes("?") ? "&" : "?"}qp=${p}`;
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        <b className="text-foreground">{queue.totalClients}</b> client{queue.totalClients === 1 ? "" : "s"} ·{" "}
        <b className="text-foreground">{queue.totalTasks}</b> task{queue.totalTasks === 1 ? "" : "s"} due
      </p>

      {queue.upcomingCallbacks.length > 0 && (
        <div className="rounded-lg border border-blue-500/40 bg-card p-3 text-sm">
          <b className="text-blue-700 dark:text-blue-400">Callbacks later today:</b>{" "}
          {queue.upcomingCallbacks.map((c, i) => (
            <span key={c.taskId}>
              {i > 0 && " · "}
              <Link href={c.href} className="underline hover:text-gold">
                {c.name}
              </Link>{" "}
              {fmtInstant(c.dueAt)}
            </span>
          ))}
        </div>
      )}

      {queue.totalClients === 0 && <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">Nothing due right now — you&apos;re all caught up.</p>}

      {queue.sections.filter((s) => s.clients > 0).map((s) => (
        <section key={s.id}>
          <h3 className="flex flex-wrap items-baseline gap-2 font-display text-base font-semibold text-foreground">
            {s.title}
            <span className="text-xs font-normal text-muted-foreground">
              {s.clients} client{s.clients === 1 ? "" : "s"} · {s.tasks} task{s.tasks === 1 ? "" : "s"}
            </span>
          </h3>
          {s.rows.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">Listed on another page of the queue.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {s.rows.map((r) => (
                <Row key={r.partyId} row={r} />
              ))}
            </ul>
          )}
        </section>
      ))}

      {showPaging && queue.pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          {queue.page > 1 ? (
            <Link href={pageHref(queue.page - 1)} className="text-gold hover:underline">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Page {queue.page} of {queue.pages}
          </span>
          {queue.page < queue.pages ? (
            <Link href={pageHref(queue.page + 1)} className="text-gold hover:underline">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
