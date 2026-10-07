import Link from "next/link";
import { getReport } from "@/lib/followup/admin";

export const dynamic = "force-dynamic";

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gold">{value}</p>
    </div>
  );
}

export default async function ReportsPage() {
  const r = await getReport();
  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-muted-foreground hover:text-gold">← Back to Dashboard</Link>
      <h1 className="font-display text-2xl font-semibold text-foreground">Follow-Up Reports</h1>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Active cycles" value={r.activeCycles} />
        <Stat label="Open tasks" value={r.pendingTasks} />
        <Stat label="Overdue tasks" value={r.overdueTasks} />
        <Stat label="Reactivation pool" value={`${r.reactivationEligible} / ${r.reactivationSelected} chosen`} />
      </div>
      <section>
        <h2 className="font-display text-lg font-semibold text-foreground">Last 7 days</h2>
        <p className="text-sm text-foreground">{r.contacts7d.attempts} contact attempts · {r.contacts7d.conversations} actual conversations · {r.contacts7d.voicemails} voicemails</p>
      </section>
      <section>
        <h2 className="font-display text-lg font-semibold text-foreground">Where active cycles are</h2>
        <ul className="text-sm text-foreground">{r.cycleDayBuckets.map((b) => <li key={b.label}>{b.label}: {b.count}</li>)}</ul>
      </section>
      <section>
        <h2 className="font-display text-lg font-semibold text-foreground">Cycles closed (last 60 days)</h2>
        {r.closedByReason.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : <ul className="text-sm text-foreground">{r.closedByReason.map((c) => <li key={c.reason}>{c.reason.replaceAll("_", " ").toLowerCase()}: {c.count}</li>)}</ul>}
      </section>
      <section>
        <h2 className="font-display text-lg font-semibold text-foreground">This month’s sales by commission tier</h2>
        {r.commissionByKind.length === 0 ? <p className="text-sm text-muted-foreground">No sales recorded this month.</p> : <ul className="text-sm text-foreground">{r.commissionByKind.map((c) => <li key={c.kind}>{c.kind.replaceAll("_", " ").toLowerCase()}: {c.count} sales, ${c.amount.toLocaleString()}</li>)}</ul>}
      </section>
    </div>
  );
}
