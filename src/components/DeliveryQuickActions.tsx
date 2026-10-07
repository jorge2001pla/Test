"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveExceptionAction, shipmentExceptionAction } from "@/app/followup-actions";

const input =
  "rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-gold focus:outline-none";

/** Report / resolve a shipment problem (damaged, lost, wrong item…). Open issues stay in the
 * queue's “Shipment exceptions & unresolved service issues” section until resolved. */
export default function DeliveryQuickActions({
  shipmentId,
  openIssue,
  profilePath,
}: {
  shipmentId: string;
  openIssue?: string | null;
  profilePath?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = openIssue
        ? await resolveExceptionAction(shipmentId, text, profilePath)
        : await shipmentExceptionAction(shipmentId, text, profilePath);
      if (!r.ok) return setError(r.error ?? "Failed.");
      setText("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      {openIssue && <p className="text-xs text-orange-700 dark:text-orange-400">Open issue: {openIssue}</p>}
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-muted-foreground underline-offset-2 hover:text-gold hover:underline">
        {openIssue ? "Resolve issue" : "Report issue"}
      </button>
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={openIssue ? "How was it resolved?" : "What’s wrong?"}
            className={`${input} w-56`}
          />
          <button type="button" disabled={pending || (!openIssue && !text.trim())} onClick={submit} className="rounded bg-gold px-2 py-1 text-xs font-medium text-brand-black disabled:opacity-50">
            {openIssue ? "Resolve" : "Log issue"}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
