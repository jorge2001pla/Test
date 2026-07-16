"use client";

import { useState, useTransition } from "react";
import {
  markDeliveredAction,
  setDeliveredCallDoneAction,
  setShippedCallDoneAction,
} from "@/app/actions";

export default function ShipmentActions({
  shipmentId,
  bookClientId,
  shippedCallDone: initialShippedCallDone,
  deliveredAt: initialDeliveredAt,
  deliveredCallDone: initialDeliveredCallDone,
}: {
  shipmentId: string;
  bookClientId: string;
  shippedCallDone: boolean;
  deliveredAt: string | null;
  deliveredCallDone: boolean;
}) {
  const [shippedCallDone, setShippedDone] = useState(initialShippedCallDone);
  const [deliveredAt, setDeliveredAt] = useState(initialDeliveredAt);
  const [deliveredCallDone, setDeliveredDone] = useState(initialDeliveredCallDone);
  const [pending, startTransition] = useTransition();

  function toggleShippedCall(checked: boolean) {
    startTransition(async () => {
      await setShippedCallDoneAction(shipmentId, bookClientId, checked);
      setShippedDone(checked);
    });
  }

  function handleMarkDelivered() {
    startTransition(async () => {
      await markDeliveredAction(shipmentId, bookClientId);
      setDeliveredAt(new Date().toISOString());
    });
  }

  function toggleDeliveredCall(checked: boolean) {
    startTransition(async () => {
      await setDeliveredCallDoneAction(shipmentId, bookClientId, checked);
      setDeliveredDone(checked);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <label className="flex items-center gap-1.5 text-foreground">
        <input
          type="checkbox"
          checked={shippedCallDone}
          disabled={pending}
          onChange={(e) => toggleShippedCall(e.target.checked)}
          className="h-4 w-4 rounded border-border accent-gold"
        />
        Called — Shipped
      </label>

      {!deliveredAt ? (
        <button
          type="button"
          onClick={handleMarkDelivered}
          disabled={pending}
          className="rounded border border-gold px-2.5 py-1 text-xs font-medium text-gold transition-colors hover:bg-gold/10 disabled:opacity-50"
        >
          Mark Delivered
        </button>
      ) : (
        <label className="flex items-center gap-1.5 text-foreground">
          <input
            type="checkbox"
            checked={deliveredCallDone}
            disabled={pending}
            onChange={(e) => toggleDeliveredCall(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-gold"
          />
          Called — Delivered
        </label>
      )}
    </div>
  );
}
