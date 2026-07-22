"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import QuickLogCall from "@/components/QuickLogCall";
import PhoneLink from "@/components/PhoneLink";
import { dismissMissedCallbackAction } from "@/app/actions";

export interface OverdueRowData {
  id: string;
  name: string;
  phone: string;
  href: string;
  reasonLabel: string;
  kind: "client" | "book";
}

export default function OverdueRowItem({ row }: { row: OverdueRowData }) {
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();

  if (hidden) return null;

  function handleDismiss() {
    startTransition(async () => {
      await dismissMissedCallbackAction(row.id, row.kind);
      setHidden(true);
    });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
      <Link href={row.href} className="font-medium text-foreground hover:text-gold hover:underline">
        {row.name}
      </Link>
      <span className="text-muted-foreground">
        <PhoneLink phone={row.phone} />
      </span>
      <span className="text-red-600 dark:text-red-400">{row.reasonLabel}</span>
      <span className="flex items-center gap-3">
        {/* Any logged call resolves the missed callback, so the row clears itself on save. */}
        <QuickLogCall id={row.id} kind={row.kind} onLogged={() => setHidden(true)} />
        <button
          type="button"
          onClick={handleDismiss}
          disabled={pending}
          className="text-xs text-muted-foreground hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
        >
          {pending ? "Clearing…" : "Dismiss"}
        </button>
      </span>
    </li>
  );
}
