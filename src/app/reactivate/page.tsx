import Link from "next/link";
import { listBookClientsWithLastContact } from "@/lib/book";
import { buildWorkTheBookQueue, DORMANT_DAYS, daysSince, nowET } from "@/lib/business-logic";
import { formatDate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import PhoneLink from "@/components/PhoneLink";
import ValueBadge from "@/components/ValueBadge";
import QuickLogCall from "@/components/QuickLogCall";
import ReactivationReview from "@/components/ReactivationReview";
import { listReactivationPool } from "@/lib/followup/admin";
import { reconcile } from "@/lib/followup/reconcile";

export const dynamic = "force-dynamic";

export default async function ReactivatePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  await reconcile(new Date());
  const pool = await listReactivationPool({ state: view === "dismissed" ? "DISMISSED" : "ELIGIBLE", limit: 200 });
  const now = nowET();
  const allClients = await listBookClientsWithLastContact();
  const queue = buildWorkTheBookQueue(allClients, now);
  const dormantCount = queue.filter((e) => e.kind === "dormant").length;
  const neverContactedCount = queue.length - dormantCount;

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted-foreground hover:text-gold">
        ← Back to Dashboard
      </Link>
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">Work the Book</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {dormantCount} gone cold ({DORMANT_DAYS}+ days since last call) and {neverContactedCount} never
          contacted at all. Cold-but-known clients first — you already have history with them.
        </p>
      </div>

      <section className="space-y-2 rounded-lg border border-gold/40 bg-card p-4">
        <h2 className="font-display text-lg font-semibold text-foreground">Finished their 30-day cycle ({pool.total})</h2>
        <p className="text-sm text-muted-foreground">
          Clients who didn’t respond (or whose cycle ended) and aren’t GHOST or do-not-contact. Nothing enters your daily queue until you select them.
          <Link href={view === "dismissed" ? "/reactivate" : "/reactivate?view=dismissed"} className="ml-2 text-gold hover:underline">{view === "dismissed" ? "Show eligible" : "Show dismissed"}</Link>
        </p>
        {pool.rows.length === 0 ? <p className="text-sm text-muted-foreground">No one waiting for review.</p> : <ReactivationReview rows={pool.rows} />}
      </section>

      <h2 className="font-display text-lg font-semibold text-foreground">Cold book (reference)</h2>
      {queue.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nothing to work right now — everyone&apos;s either been touched recently or is already on
          your radar today.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-background text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Client</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2">Value</th>
                <th className="px-4 py-2">Last Contact</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Last Note</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {queue.map((e) => (
                <tr key={e.client.id} className="hover:bg-gold/5">
                  <td className="px-4 py-3">
                    <Link
                      href={`/book/${e.client.id}`}
                      className="font-medium text-foreground hover:text-gold hover:underline"
                    >
                      {[e.client.firstName, e.client.lastName].filter(Boolean).join(" ") || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <PhoneLink phone={e.client.phone} />
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    <ValueBadge value={e.client.lifetimeValue} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {e.kind === "dormant"
                      ? `${formatDate((e.client.lastContactAt as string).slice(0, 10))} (${daysSince(e.client.lastContactAt as string, now)}d)`
                      : "Never contacted"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={e.client.status} />
                  </td>
                  <td className="px-4 py-3 max-w-xs truncate text-muted-foreground">
                    {e.client.lastNote ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <QuickLogCall id={e.client.id} kind="book" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
