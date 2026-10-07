"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setExpectedDeliveryAction } from "@/app/followup-actions";

/** Set or change the carrier's estimated delivery date. It's only an estimate — the shipment isn't
 * delivered until you mark it — but the “has it been delivered?” reminder moves to that date. */
export default function ExpectedDelivery({ shipmentId, current, profilePath }: { shipmentId: string; current?: string | null; profilePath?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(current ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded border border-border px-2 py-0.5 text-xs text-foreground hover:border-gold hover:text-gold">
        {current ? `Expected ${current} · change` : "Set expected delivery"}
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-gold focus:outline-none" />
      <button
        type="button"
        disabled={pending || !date}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const r = await setExpectedDeliveryAction(shipmentId, date, profilePath);
            if (!r.ok) return setError(r.error ?? "Failed.");
            window.dispatchEvent(new CustomEvent("prc-toast", { detail: r.message ?? "Saved." }));
            setOpen(false);
            router.refresh();
          })
        }
        className="rounded bg-gold px-2 py-1 text-xs font-medium text-brand-black disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground">Cancel</button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
