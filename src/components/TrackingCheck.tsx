"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordDeliveryAction } from "@/app/followup-actions";
import ExpectedDelivery from "@/components/ExpectedDelivery";

/** For the “has it been delivered?” reminder: open the carrier tracking page, then mark it delivered
 * here once it says so (that creates the same-day check-in call). */
export default function TrackingCheck({ shipmentId, trackingLink, profilePath }: { shipmentId: string; trackingLink: string | null; profilePath?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isUrl = !!trackingLink && /^https?:\/\//i.test(trackingLink);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isUrl && (
        <a href={trackingLink!} target="_blank" rel="noopener noreferrer" className="rounded border border-border px-2 py-0.5 text-xs text-foreground hover:border-gold hover:text-gold">
          Open tracking ↗
        </a>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const r = await recordDeliveryAction(shipmentId, null, profilePath);
            if (!r.ok) return setError(r.error ?? "Failed.");
            window.dispatchEvent(new CustomEvent("prc-toast", { detail: r.message ?? "Marked delivered." }));
            router.refresh();
          })
        }
        className="rounded border border-gold px-2 py-0.5 text-xs font-medium text-gold hover:bg-gold/10 disabled:opacity-50"
      >
        {pending ? "Saving…" : "It’s delivered"}
      </button>
      <ExpectedDelivery shipmentId={shipmentId} profilePath={profilePath} />
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
