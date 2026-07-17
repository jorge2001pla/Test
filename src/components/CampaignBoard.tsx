import Link from "next/link";
import {
  listPromotions,
  getActivePromotion,
  getPromotionProgress,
  listNotCalledAboutPromotion,
  type PromotionKind,
} from "@/lib/promotions";
import { formatDate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import ValueBadge from "@/components/ValueBadge";
import QuickLogCall from "@/components/QuickLogCall";
import PromotionActions from "@/components/PromotionActions";
import { createPromotionAction } from "@/app/actions";

interface CampaignCopy {
  title: string;
  subtitle: string;
  startLabel: string;
  namePlaceholder: string;
}

/** Shared board for a single campaign channel (Promotion or Coin of the Week). Both tabs render
 * this — same email/text/call tracking, scoped to one `kind`. */
export default async function CampaignBoard({ kind, copy }: { kind: PromotionKind; copy: CampaignCopy }) {
  const [promotions, active] = await Promise.all([listPromotions(kind), getActivePromotion(kind)]);
  const progress = active ? await getPromotionProgress(active.id) : null;
  const callTargets = active ? await listNotCalledAboutPromotion(active.id) : [];
  const past = promotions.filter((p) => p.id !== active?.id);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">{copy.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>
      </div>

      {active && progress ? (
        <div className="rounded-lg border border-gold/40 bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-foreground">{active.name}</h2>
              {active.description && (
                <p className="mt-1 text-sm text-muted-foreground">{active.description}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Started {formatDate(active.createdAt.slice(0, 10))}
              </p>
            </div>
            <PromotionActions promotionId={active.id} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Emailed</p>
              <p className="mt-1 text-xl font-semibold text-gold">
                {progress.emailedCount}
                <span className="text-sm font-normal text-muted-foreground"> / {progress.totalClients}</span>
              </p>
            </div>
            <div className="rounded border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Texted</p>
              <p className="mt-1 text-xl font-semibold text-gold">
                {progress.textedCount}
                <span className="text-sm font-normal text-muted-foreground"> / {progress.totalClients}</span>
              </p>
            </div>
            <div className="rounded border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Called</p>
              <p className="mt-1 text-xl font-semibold text-gold">
                {progress.calledCount}
                <span className="text-sm font-normal text-muted-foreground"> / {progress.totalClients}</span>
              </p>
            </div>
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-medium text-foreground">
              Not yet called ({callTargets.length}) — biggest clients first
            </h3>
            {callTargets.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Everyone&apos;s been called. Nice work.</p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-background text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Client</th>
                      <th className="px-4 py-2">Phone</th>
                      <th className="px-4 py-2">Value</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {callTargets.map((c) => (
                      <tr key={c.id} className="hover:bg-gold/5">
                        <td className="px-4 py-3">
                          <Link
                            href={`/book/${c.id}`}
                            className="font-medium text-foreground hover:text-gold hover:underline"
                          >
                            {[c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed"}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{c.phone ?? "—"}</td>
                        <td className="px-4 py-3 text-foreground">
                          <ValueBadge value={c.lifetimeValue} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={c.status} />
                        </td>
                        <td className="px-4 py-3">
                          <QuickLogCall id={c.id} kind="book" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          Nothing running right now. Start one below.
        </p>
      )}

      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-display text-lg font-semibold text-foreground">
          {active ? `Start a New ${copy.startLabel}` : `Start a ${copy.startLabel}`}
        </h2>
        {active && (
          <p className="mt-1 text-sm text-muted-foreground">
            Starting a new one ends &quot;{active.name}&quot; automatically.
          </p>
        )}
        <form action={createPromotionAction} className="mt-3 space-y-3">
          <input type="hidden" name="kind" value={kind} />
          <div>
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="name">
              {copy.startLabel} Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              placeholder={copy.namePlaceholder}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={2}
              placeholder="Optional — what's the offer?"
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="rounded bg-gold px-4 py-2 text-sm font-medium text-brand-black transition-opacity hover:opacity-90"
          >
            Start {copy.startLabel}
          </button>
        </form>
      </div>

      {past.length > 0 && (
        <div>
          <h2 className="font-display text-lg font-semibold text-foreground">Past</h2>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
            {past.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="font-medium text-foreground">{p.name}</span>
                <span className="text-muted-foreground">{formatDate(p.createdAt.slice(0, 10))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
