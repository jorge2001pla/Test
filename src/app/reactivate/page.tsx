import Link from "next/link";
import { listBookClientsWithLastContact } from "@/lib/book";
import { buildWorkTheBookQueue, DORMANT_DAYS, daysSince } from "@/lib/business-logic";
import { formatDate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

export default async function ReactivatePage() {
  const now = new Date();
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
                <th className="px-4 py-2">Last Contact</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Last Note</th>
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
                  <td className="px-4 py-3 text-muted-foreground">{e.client.phone ?? "—"}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
