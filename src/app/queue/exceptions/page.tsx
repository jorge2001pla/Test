import Link from "next/link";
import LogContactPanel from "@/components/LogContactPanel";
import TaskActions from "@/components/TaskActions";
import DeliveryQuickActions from "@/components/DeliveryQuickActions";
import { getExceptions, type ExceptionRow } from "@/lib/followup/queue";
import { reconcile } from "@/lib/followup/reconcile";
import { fmtInstant } from "@/lib/followup/present";

export const dynamic = "force-dynamic";

function Section({
  title,
  help,
  rows,
  render,
}: {
  title: string;
  help: string;
  rows: ExceptionRow[];
  render?: (r: ExceptionRow) => React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-foreground">
        {title} <span className="text-sm font-normal text-muted-foreground">({rows.length})</span>
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{help}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">None — all clear.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {rows.map((r, i) => (
            <li key={`${r.partyId}-${r.taskId ?? r.shipmentId ?? i}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <Link href={r.href} className="font-medium text-foreground hover:text-gold hover:underline">{r.name}</Link>
                <p className="text-sm text-muted-foreground">
                  {r.detail}
                  {r.date && r.date.includes("T") ? ` — was ${fmtInstant(r.date)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {render?.(r)}
                <LogContactPanel partyId={r.partyId} name={r.name} defaults={{ taskId: r.taskId ?? null, shipmentId: r.shipmentId ?? null }} showDelivery={!!r.shipmentId} profilePath={r.href} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function ExceptionsPage() {
  const now = new Date();
  await reconcile(now);
  const ex = await getExceptions(now);
  return (
    <div className="space-y-8">
      <div>
        <Link href="/queue" className="text-sm text-gold hover:underline">← Daily Queue</Link>
        <h1 className="mt-1 font-display text-2xl font-semibold text-foreground">Exceptions</h1>
        <p className="mt-1 text-sm text-muted-foreground">Things that fell through a crack. Aim for all four lists to be empty.</p>
      </div>
      <Section
        title="Active clients with no next action"
        help="A client in an active 30-day cycle with nothing scheduled and no pause reason. Open the profile to add a task or document why they are paused."
        rows={ex.noNextAction}
      />
      <Section
        title="Overdue callbacks"
        help="Promised callbacks that passed without a completed call."
        rows={ex.overdueCallbacks}
        render={(r) => (r.taskId ? <TaskActions taskId={r.taskId} timed /> : null)}
      />
      <Section
        title="Missed cadence steps"
        help="Steps that came due and were not worked. They are kept for the record — they never create catch-up calls."
        rows={ex.missedSteps}
      />
      <Section
        title="Unconfirmed deliveries"
        help="Delivered, but the client has not confirmed receipt. An unanswered call does not clear these."
        rows={ex.unconfirmedDeliveries}
        render={(r) => (r.shipmentId ? <DeliveryQuickActions shipmentId={r.shipmentId} /> : null)}
      />
    </div>
  );
}
