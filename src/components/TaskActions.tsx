"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelTaskAction, completeTaskAction, rescheduleTaskAction } from "@/app/followup-actions";
import { TIME_OPTIONS } from "@/lib/time-options";

const input =
  "rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-gold focus:outline-none";
const btn = "text-xs text-muted-foreground underline-offset-2 hover:text-gold hover:underline disabled:opacity-50";

/** Complete / reschedule / cancel one persistent task. Cancelling requires a reason. */
export default function TaskActions({ taskId, timed = false }: { taskId: string; timed?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "reschedule" | "cancel">("none");
  const [more, setMore] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Failed.");
      setMode("none");
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending} className={btn} onClick={() => run(() => completeTaskAction(taskId))}>Done</button>
        <button type="button" className={btn} onClick={() => { setMore((v) => !v); if (more) setMode("none"); }} aria-label="More task options">{more ? "less" : "⋯"}</button>
        {more && (
          <>
            <button type="button" disabled={pending} className={btn} onClick={() => setMode(mode === "reschedule" ? "none" : "reschedule")}>Reschedule</button>
            <button type="button" disabled={pending} className={btn} onClick={() => setMode(mode === "cancel" ? "none" : "cancel")}>Cancel</button>
          </>
        )}
      </div>
      {mode === "reschedule" && (
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
          {timed && (
            <select value={time} onChange={(e) => setTime(e.target.value)} className={input}>
              <option value="">— time —</option>
              {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          )}
          <button type="button" disabled={pending || !date || (timed && !time)} className="rounded bg-gold px-2 py-1 text-xs font-medium text-brand-black disabled:opacity-50"
            onClick={() => run(() => rescheduleTaskAction(taskId, date, timed ? time : null))}>Move</button>
        </div>
      )}
      {mode === "cancel" && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className={`${input} w-48`} />
          <button type="button" disabled={pending || !reason.trim()} className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
            onClick={() => run(() => cancelTaskAction(taskId, reason))}>Cancel task</button>
        </div>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
