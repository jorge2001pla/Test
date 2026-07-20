"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { reactivatePromotionAction } from "@/app/actions";

export default function ReactivateCampaignButton({ promotionId }: { promotionId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleReactivate() {
    startTransition(async () => {
      await reactivatePromotionAction(promotionId);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={handleReactivate}
      className="rounded border border-gold px-2.5 py-1 text-xs font-medium text-gold transition-colors hover:bg-gold/10 disabled:opacity-50"
    >
      {pending ? "Reactivating…" : "Reactivate"}
    </button>
  );
}
