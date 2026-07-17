"use client";

import { useState, useTransition } from "react";
import { updateLifetimeValueAction } from "@/app/actions";
import ValueBadge from "@/components/ValueBadge";

export default function LifetimeValueEditor({
  bookClientId,
  value: initialValue,
}: {
  bookClientId: string;
  value: number;
}) {
  const [value, setValue] = useState(initialValue);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(initialValue));
  const [pending, startTransition] = useTransition();

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    startTransition(async () => {
      await updateLifetimeValueAction(bookClientId, parsed);
      setValue(parsed);
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <form onSubmit={handleSave} className="flex items-center gap-2">
        <input
          type="number"
          step="0.01"
          min="0"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-32 rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:border-gold focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-gold px-2.5 py-1 text-xs font-medium text-brand-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(String(value));
            setEditing(false);
          }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex items-center gap-2 text-sm hover:text-gold"
    >
      <ValueBadge value={value} />
      <span className="text-xs text-muted-foreground underline">edit</span>
    </button>
  );
}
