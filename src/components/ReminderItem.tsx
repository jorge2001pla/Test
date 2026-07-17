"use client";

import { useState, useTransition } from "react";
import { setReminderDoneAction, deleteReminderAction } from "@/app/actions";
import { formatDate } from "@/lib/format";

export default function ReminderItem({
  id,
  text,
  dueAt,
  overdue,
}: {
  id: string;
  text: string;
  dueAt: string | null;
  overdue: boolean;
}) {
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();

  if (hidden) return null;

  function handleDone() {
    startTransition(async () => {
      await setReminderDoneAction(id, true);
      setHidden(true);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteReminderAction(id);
      setHidden(true);
    });
  }

  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <label className="flex flex-1 items-start gap-2 text-sm">
        <input
          type="checkbox"
          disabled={pending}
          onChange={handleDone}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-gold"
        />
        <span className={overdue ? "text-red-600 dark:text-red-400" : "text-foreground"}>
          {text}
          {dueAt && (
            <span className="ml-2 text-xs text-muted-foreground">Due {formatDate(dueAt)}</span>
          )}
        </span>
      </label>
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
