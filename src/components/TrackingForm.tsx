"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTrackingAction } from "@/app/followup-actions";

const input =
  "rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-gold focus:outline-none";

/** Adds tracking to a sale recorded earlier — tracking usually shows up a day or two later. */
export default function TrackingForm({ orderId, profilePath }: { orderId: string; profilePath?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [carrier, setCarrier] = useState("USPS");
  const [link, setLink] = useState("");
  const [expected, setExpected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await addTrackingAction(orderId, carrier, link, expected || null, profilePath);
      if (!r.ok) return setError(r.error ?? "Failed.");
      window.dispatchEvent(new CustomEvent("prc-toast", { detail: r.message ?? "Tracking added." }));
      setOpen(false);
      setLink("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded border border-gold px-2 py-0.5 text-xs font-medium text-gold hover:bg-gold/10">
        Add tracking
      </button>
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <select value={carrier} onChange={(e) => setCarrier(e.target.value)} className={input}>
          <option>USPS</option>
          <option>FedEx</option>
          <option>Other</option>
        </select>
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Tracking link" className={`${input} w-56`} />
        <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} title="Expected delivery (estimate, optional)" className={input} />
        <button type="button" disabled={pending || !link.trim()} onClick={save} className="rounded bg-gold px-2 py-1 text-xs font-medium text-brand-black disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground">Cancel</button>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
