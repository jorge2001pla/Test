import Link from "next/link";
import {
  listPromotions,
  getActivePromotion,
  getPromotionProgress,
  listNotCalledAboutPromotion,
} from "@/lib/promotions";
import { formatDate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import ValueBadge from "@/components/ValueBadge";
import QuickLogCall from "@/components/QuickLogCall";
import PromotionActions from "@/components/PromotionActions";
import { createPromotionAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function PromotionsPage() {
  const [promotions, activePromotion] = await Promise.all([listPromotions(), getActivePromotion()]);
  const progress = activePromotion ? await getPromotionProgress(activePromotion.id) : null;
  const callTargets = activePromotion ? await listNotCalledAboutPromotion(activePromotion.id) : [];
  const pastPromotions = promotions.filter((p) => p.id !== activePromotion?.id);

  return (
    <div className="space-y-8">
      <Link href="/" className="text-sm text-muted-foreground hover:text-gold">
        ← Back to Dashboard
      </Link>
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">Promotions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track a promo push across email (Klaviyo), text, and calls — make sure every client
          gets all three.
        </p>
      </div>

      {activePromotion && progress ? (
        <div className="rounded-lg border border-gold/40 bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-foreground">{activePromotion.name}</h2>
              {activePromotion.description && (
                <p className="mt-1 text-sm text-muted-foreground">{activePromotion.description}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Started {formatDate(activePromotion.createdAt.slice(0, 10))}
              </p>
            </div>
            <PromotionActions promotionId={activePromotion.id} />
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
          No active promotion. Start one below.
        </p>
      )}

      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-display text-lg font-semibold text-foreground">
          {activePromotion ? "Start a New Promotion" : "Start a Promotion"}
        </h2>
        {activePromotion && (
          <p className="mt-1 text-sm text-muted-foreground">
            Starting a new one ends &quot;{activePromotion.name}&quot; automatically.
          </p>
        )}
        <form action={createPromotionAction} className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="name">
              Promotion Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              placeholder="e.g. Liberty Bell Gold Coin — July 2026"
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
            Start Promotion
          </button>
        </form>
      </div>

      {pastPromotions.length > 0 && (
        <div>
          <h2 className="font-display text-lg font-semibold text-foreground">Past Promotions</h2>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
            {pastPromotions.map((p) => (
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
