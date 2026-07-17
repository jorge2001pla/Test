"use client";

import { useState, useTransition } from "react";
import { deleteNoteAction } from "@/app/actions";
import { formatDateTime } from "@/lib/format";

export default function NoteItem({
  id,
  text,
  createdAt,
}: {
  id: string;
  text: string;
  createdAt: string;
}) {
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();

  if (hidden) return null;

  function handleDelete() {
    startTransition(async () => {
      await deleteNoteAction(id);
      setHidden(true);
    });
  }

  return (
    <li className="flex items-start justify-between gap-3 rounded border border-border bg-background p-3 text-sm">
      <div>
        <p className="whitespace-pre-wrap text-foreground">{text}</p>
        <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(createdAt)}</p>
      </div>
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        className="shrink-0 text-xs text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
      >
        Remove
      </button>
    </li>
  );
}
