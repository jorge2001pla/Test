"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { quickLogCallAction, quickLogBookCallAction } from "@/app/actions";
import { CLIENT_STATUSES, STATUS_LABELS, type ClientStatus } from "@/lib/types";
import { TIME_OPTIONS } from "@/lib/time-options";

const inputClass =
  "w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-gold focus:outline-none";

export default function QuickLogCall({
  id,
  kind,
  onLogged,
}: {
  id: string;
  kind: "client" | "book";
  /** Called after a successful save with the resulting status — a row can use this to hide
   * itself on a final dispo but stay visible on Not Available (attempted, circle back later). */
  onLogged?: (resultingStatus: ClientStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<ClientStatus>("NO_DISPO");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (done) {
    return <span className="text-xs text-muted-foreground">✓ Logged</span>;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    const resultingStatus = status;
    startTransition(async () => {
      const action = kind === "client" ? quickLogCallAction : quickLogBookCallAction;
      await action({
        id,
        noteText: note,
        resultingStatus,
        callbackDate: date || undefined,
        callbackTime: time || undefined,
      });
      // Not Available is an attempt, not a completed touch — leave the button ready for the
      // circle-back call instead of collapsing to "Logged".
      if (resultingStatus !== "NOT_AVAILABLE") {
        setDone(true);
      }
      setNote("");
      setOpen(false);
      onLogged?.(resultingStatus);
    });
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-gold px-2.5 py-1 text-xs font-medium text-gold transition-colors hover:bg-gold/10"
      >
        Log Call
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-border bg-card p-3 text-left shadow-lg">
          <form onSubmit={handleSubmit} className="space-y-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              required
              placeholder="What happened on the call?"
              autoFocus
              className={inputClass}
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ClientStatus)}
              className={inputClass}
            >
              {CLIENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            {status === "CALLBACK" && (
              <div className="flex gap-2">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputClass}
                />
                <select value={time} onChange={(e) => setTime(e.target.value)} className={inputClass}>
                  <option value="">— time —</option>
                  {TIME_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded bg-gold px-3 py-1 text-xs font-medium text-brand-black transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
