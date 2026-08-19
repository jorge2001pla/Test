import Link from "next/link";
import { listClientsWithLastCallNote } from "@/lib/clients";
import { buildFollowUpSections, type FollowUpRow } from "@/lib/business-logic";
import { formatCurrency, formatDaysLeft } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import type { ClientWithPreview } from "@/lib/clients";
import { PRODUCT_INTERESTS, type Client } from "@/lib/types";

const INTEREST_TAGS: Record<string, string> = Object.fromEntries(
  PRODUCT_INTERESTS.map((i) => [i.key, i.tag])
);

/** Compact qualification/interest tags under the client name — capped at two
 * interests plus a "+n" so the table never widens; full detail lives on the profile. */
function ProfileTags({ client }: { client: Client }) {
  const shown = client.productInterests.slice(0, 2);
  const extra = client.productInterests.length - shown.length;
  if (client.qualification !== "QUALIFIED" && shown.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {client.qualification === "QUALIFIED" && (
        <span className="rounded bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold dark:text-gold-bright">
          Qualified
        </span>
      )}
      {shown.map((k) => (
        <span
          key={k}
          className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          {INTEREST_TAGS[k]}
        </span>
      ))}
      {extra > 0 && (
        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          +{extra}
        </span>
      )}
    </div>
  );
}

export const dynamic = "force-dynamic";

function FollowUpTable({
  rows,
  emptyText,
}: {
  rows: FollowUpRow<ClientWithPreview>[];
  emptyText: string;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-background text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2">Client</th>
            <th className="px-4 py-2">Phone</th>
            <th className="px-4 py-2">First Sale</th>
            <th className="px-4 py-2">Days Left</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Last Call</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(({ client, daysLeft, fallbackPitch }) => (
            <tr key={client.id} className="hover:bg-gold/5">
              <td className="px-4 py-3">
                <Link href={`/clients/${client.id}`} className="font-medium text-foreground hover:text-gold hover:underline">
                  {client.name}
                </Link>
                {client.opener && (
                  <div className="text-xs text-muted-foreground">Opener: {client.opener}</div>
                )}
                <ProfileTags client={client} />
                {fallbackPitch && (
                  <div className="mt-1 inline-flex items-center gap-1 rounded bg-gold/15 px-1.5 py-0.5 text-xs text-gold dark:text-gold-bright">
                    Pitch Double Eagles as a bullion alternative
                  </div>
                )}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{client.phone}</td>
              <td className="px-4 py-3 text-foreground">
                {formatCurrency(client.firstSaleAmount)}
              </td>
              <td className="px-4 py-3">
                <span
                  className={
                    daysLeft <= 3
                      ? "font-semibold text-red-600 dark:text-red-400"
                      : daysLeft <= 7
                        ? "font-semibold text-gold"
                        : "text-foreground"
                  }
                >
                  {formatDaysLeft(daysLeft)}
                </span>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={client.status} />
              </td>
              <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">
                {client.lastCallNote ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function FollowUpPage() {
  const clients = await listClientsWithLastCallNote();
  const sections = buildFollowUpSections(clients);

  return (
    <div className="space-y-10">
      <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground">50% Follow-Up</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Clients still inside their 15-day, 50%-commission window. Callbacks and clients
              whose window closes today come first — that&apos;s what to maximize right now.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
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
        <div className="mt-4">
          <FollowUpTable rows={sections.priority} emptyText="Nothing urgent right now." />
        </div>
      </div>

      {sections.rest.length > 0 && (
        <div>
          <h2 className="font-display text-lg font-semibold text-foreground">Rest of the Window</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Still in the 15-day window, not yet urgent.
          </p>
          <div className="mt-4">
            <FollowUpTable rows={sections.rest} emptyText="Nothing else in the window." />
          </div>
        </div>
      )}

      <div>
        <h2 className="font-display text-lg font-semibold text-foreground">Not Interested — Long-Term List</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Out of the active blitz rotation, kept visible for low-touch follow-up.
        </p>
        <div className="mt-4">
          <FollowUpTable rows={sections.notInterested} emptyText="No clients here yet." />
        </div>
      </div>

      <div>
        <h2 className="font-display text-lg font-semibold text-foreground">Sold — Closed</h2>
        <div className="mt-4">
          <FollowUpTable rows={sections.sold} emptyText="No closed clients yet." />
        </div>
      </div>
    </div>
  );
}
