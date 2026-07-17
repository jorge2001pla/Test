import Link from "next/link";
import { listBookClientsWithLastContact } from "@/lib/book";
import { DORMANT_DAYS, daysSince } from "@/lib/business-logic";
import { formatDate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

export default async function ReactivatePage() {
  const now = new Date();
  const allClients = await listBookClientsWithLastContact();

  const dormant = allClients
    .filter(
      (c) =>
        c.status !== "NOT_INTERESTED" && c.lastContactAt !== null && daysSince(c.lastContactAt, now) >= DORMANT_DAYS
    )
    .sort((a, b) => (a.lastContactAt as string).localeCompare(b.lastContactAt as string));

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted-foreground hover:text-gold">
        ← Back to Dashboard
      </Link>
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">Reactivate</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Book clients you haven&apos;t spoken to in {DORMANT_DAYS}+ days ({dormant.length}). Oldest
          contact first — these are your best shot at closing without needing a new lead.
        </p>
      </div>

      {dormant.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nothing dormant right now — everyone&apos;s been touched within {DORMANT_DAYS} days.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-background text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Client</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2">Last Contact</th>
                <th className="px-4 py-2">Days Since</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Last Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {dormant.map((c) => (
                <tr key={c.id} className="hover:bg-gold/5">
                  <td className="px-4 py-3">
                    <Link
                      href={`/book/${c.id}`}
                      className="font-medium text-foreground hover:text-gold hover:underline"
                    >
                      {[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate((c.lastContactAt as string).slice(0, 10))}
                  </td>
                  <td className="px-4 py-3 text-foreground">{daysSince(c.lastContactAt as string, now)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3 max-w-xs truncate text-muted-foreground">{c.lastNote ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
