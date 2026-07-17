import Link from "next/link";
import { listBookClients } from "@/lib/book";
import StatusBadge from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

export default async function BookPage() {
  const clients = await listBookClients();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your existing client book ({clients.length} clients).
          </p>
        </div>
        <Link
          href="/book/new"
          className="rounded bg-gold px-4 py-2 text-sm font-medium text-brand-black transition-opacity hover:opacity-90"
        >
          + Log New Account
        </Link>
      </div>

      {clients.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No clients yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-background text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clients.map((c) => (
                <tr key={c.id} className="hover:bg-gold/5">
                  <td className="px-4 py-3">
                    <Link
                      href={`/book/${c.id}`}
                      className="font-medium text-foreground hover:text-gold hover:underline"
                    >
                      {[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.email ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.phone ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
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
