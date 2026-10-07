"use client";

import { useState, useTransition } from "react";
import { ensurePartyAction } from "@/app/followup-actions";
import LogContactPanel from "@/components/LogContactPanel";

interface Resolved {
  partyId: string;
  name: string;
  hasBook: boolean;
}

/** Drop-in “Log Contact” button for screens that only know the legacy record id (campaign board,
 * work-the-book list). Resolves the canonical client, then opens the unified Log Contact dialog. */
export default function QuickLogCall({ id, kind }: { id: string; kind: "client" | "book" }) {
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const r = await ensurePartyAction(kind, id);
            if (!r) return setError("Client not found.");
            setResolved(r);
          })
        }
        className="rounded border border-gold px-2.5 py-1 text-xs font-medium text-gold transition-colors hover:bg-gold/10 disabled:opacity-50"
      >
        {pending ? "…" : "Log Contact"}
      </button>
      {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
      {resolved && (
        <LogContactPanel
          partyId={resolved.partyId}
          name={resolved.name}
          hasBook={resolved.hasBook}
          initialOpen
          onClose={() => setResolved(null)}
          triggerClass="hidden"
        />
      )}
    </>
  );
}
