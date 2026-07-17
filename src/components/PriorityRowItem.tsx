"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import PhoneLink from "@/components/PhoneLink";
import QuickLogCall from "@/components/QuickLogCall";
import { setShippedCallDoneAction, setDeliveredCallDoneAction } from "@/app/actions";
import type { ClientStatus } from "@/lib/types";

export interface ShipmentCallAction {
  shipmentId: string;
  bookClientId: string;
  type: "shipped" | "delivered";
}

export interface PriorityRowData {
  id: string;
  name: string;
  phone: string;
  href: string;
  status: ClientStatus;
  reasonLabel: string;
  kind: "client" | "book";
  muted: boolean;
  shipmentAction?: ShipmentCallAction;
}

export default function PriorityRowItem({ row }: { row: PriorityRowData }) {
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();

  if (hidden) return null;

  function handleShipmentDone() {
    const action = row.shipmentAction;
    if (!action) return;
    startTransition(async () => {
      if (action.type === "shipped") {
        await setShippedCallDoneAction(action.shipmentId, action.bookClientId, true);
      } else {
        await setDeliveredCallDoneAction(action.shipmentId, action.bookClientId, true);
      }
      setHidden(true);
    });
  }

  return (
    <tr className="hover:bg-gold/5">
      <td className="px-4 py-3">
        <Link href={row.href} className="font-medium text-foreground hover:text-gold hover:underline">
          {row.name}
        </Link>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        <PhoneLink phone={row.phone} />
      </td>
      <td className={row.muted ? "px-4 py-3 text-muted-foreground" : "px-4 py-3 text-foreground"}>
        {row.reasonLabel}
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={row.status} />
      </td>
      <td className="px-4 py-3">
        {row.shipmentAction ? (
          <button
            type="button"
            onClick={handleShipmentDone}
            disabled={pending}
            className="rounded border border-gold px-2.5 py-1 text-xs font-medium text-gold transition-colors hover:bg-gold/10 disabled:opacity-50"
          >
            {pending
              ? "Saving…"
              : row.shipmentAction.type === "shipped"
                ? "Called — Shipped"
                : "Called — Delivered"}
          </button>
        ) : (
          <QuickLogCall id={row.id} kind={row.kind} onLogged={() => setHidden(true)} />
        )}
      </td>
    </tr>
  );
}
