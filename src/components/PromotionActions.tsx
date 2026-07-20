"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markAllEmailedAction, markAllTextedAction, endPromotionAction } from "@/app/actions";

export default function PromotionActions({
  promotionId,
  endLabel = "End Promotion",
}: {
  promotionId: string;
  endLabel?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const router = useRouter();

  function handle(action: (id: string) => Promise<void>) {
    startTransition(async () => {
      await action(promotionId);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => handle(markAllEmailedAction)}
        className="rounded bg-gold px-3 py-1.5 text-xs font-medium text-brand-black transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        Mark All Emailed
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => handle(markAllTextedAction)}
        className="rounded bg-gold px-3 py-1.5 text-xs font-medium text-brand-black transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        Mark All Texted
      </button>
      {confirmEnd ? (
        <span className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">End this push?</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => handle(endPromotionAction)}
            className="rounded border border-red-600/40 px-2.5 py-1 font-medium text-red-600 hover:bg-red-600/10 dark:text-red-400"
          >
            Confirm
          </button>
          <button type="button" onClick={() => setConfirmEnd(false)} className="text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmEnd(true)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {endLabel}
        </button>
      )}
    </div>
  );
}
