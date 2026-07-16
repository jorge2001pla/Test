"use client";

import { useState, useTransition } from "react";
import { addClientToBookAction, removeClientFromBookAction } from "@/app/actions";

export default function AddToBookToggle({
  clientId,
  initiallyInBook,
}: {
  clientId: string;
  initiallyInBook: boolean;
}) {
  const [inBook, setInBook] = useState(initiallyInBook);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pending, startTransition] = useTransition();

  function handleCheckboxChange(checked: boolean) {
    if (checked) {
      startTransition(async () => {
        await addClientToBookAction(clientId);
        setInBook(true);
      });
    } else {
      setConfirming(true);
      setConfirmText("");
    }
  }

  function handleConfirmDelete() {
    if (confirmText.trim().toUpperCase() !== "YES") return;
    startTransition(async () => {
      await removeClientFromBookAction(clientId);
      setInBook(false);
      setConfirming(false);
      setConfirmText("");
    });
  }

  return (
    <div>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={inBook}
          disabled={pending}
          onChange={(e) => handleCheckboxChange(e.target.checked)}
          className="h-4 w-4 rounded border-border accent-gold"
        />
        Add to my Client Book
      </label>

      {confirming && (
        <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-sm text-red-700 dark:text-red-400">
            Are you sure you want to remove this client forever? Type <strong>YES</strong> to
            confirm.
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="mt-2 w-32 rounded border border-red-500/40 bg-background px-2 py-1 text-sm text-foreground focus:border-red-500 focus:outline-none"
            placeholder="YES"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={confirmText.trim().toUpperCase() !== "YES" || pending}
              className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Remove from Book
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setConfirmText("");
              }}
              className="rounded border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-border/40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
