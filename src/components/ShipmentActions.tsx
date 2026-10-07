"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordDeliveryAction } from "@/app/followup-actions";
import DeliveryQuickActions from "@/components/DeliveryQuickActions";
import LogContactPanel from "@/components/LogContactPanel";
import ExpectedDelivery from "@/components/ExpectedDelivery";

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

/**
 * Manual shipment/delivery controls. “Delivered” and “receipt confirmed” are separate facts:
 * recording a delivery creates a same-day check-in task, and only a client-confirmed receipt
 * (logged via Log Contact → “Delivery confirmed by client”) completes it. An unanswered call never does.
 */
export default function ShipmentActions({
  shipmentId,
  partyId,
  name,
  deliveredDate,
  receiptConfirmed,
  openIssue,
  profilePath,
  hasBook = true,
  expectedDelivery = null,
}: {
  shipmentId: string;
  partyId: string;
  name: string;
  deliveredDate: string | null;
  receiptConfirmed: boolean;
  openIssue: string | null;
  profilePath: string;
  hasBook?: boolean;
  expectedDelivery?: string | null;
}) {
  const router = useRouter();
  const [date, setDate] = useState(etToday());
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function markDelivered() {
    setError(null);
    startTransition(async () => {
      const r = await recordDeliveryAction(shipmentId, date, profilePath);
      if (!r.ok) return setError(r.error ?? "Failed.");
      setMsg(r.message ?? "Saved.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        {!deliveredDate ? (
          <>
            <input type="date" value={date} max={etToday()} onChange={(e) => setDate(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-gold focus:outline-none" />
            <button type="button" onClick={markDelivered} disabled={pending} className="rounded border border-gold px-2.5 py-1 text-xs font-medium text-gold transition-colors hover:bg-gold/10 disabled:opacity-50">
              {pending ? "Saving…" : "Mark Delivered"}
            </button>
          </>
        ) : receiptConfirmed ? (
          <span className="text-xs font-medium text-green-700 dark:text-green-400">✓ Delivered {deliveredDate} · receipt confirmed</span>
        ) : (
          <>
            <span className="text-xs font-medium text-orange-700 dark:text-orange-400">Delivered {deliveredDate} · receipt NOT confirmed yet</span>
            <LogContactPanel partyId={partyId} name={name} defaults={{ shipmentId, purpose: "Delivery check-in" }} showDelivery hasBook={hasBook} profilePath={profilePath} triggerLabel="Log check-in call" />
          </>
        )}
      </div>
      {!deliveredDate && <ExpectedDelivery shipmentId={shipmentId} current={expectedDelivery} profilePath={profilePath} />}
      <DeliveryQuickActions shipmentId={shipmentId} openIssue={openIssue} profilePath={profilePath} />
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
