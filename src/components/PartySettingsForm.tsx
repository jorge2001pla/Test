"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTaskAction, updatePartyAction } from "@/app/followup-actions";
import type { Restrictions } from "@/lib/followup/config";
import { TIME_OPTIONS } from "@/lib/time-options";

const input =
  "rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-gold focus:outline-none";
const lbl = "mb-1 block text-xs font-medium text-muted-foreground";

const ZONES = [
  ["", "Unknown — guess from area code"],
  ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona (no DST)"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
] as const;

function key(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
}

export default function PartySettingsForm({
  partyId,
  profilePath,
  initial,
}: {
  partyId: string;
  profilePath: string;
  initial: { openingDate: string; timezone: string; interests: string; restrictions: Restrictions; pauseReason: string; pauseUntil: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const setR = (k: keyof Restrictions, val: boolean) => setV({ ...v, restrictions: { ...v.restrictions, [k]: val } });

  function save() {
    setMsg(null);
    startTransition(async () => {
      const r = await updatePartyAction(
        partyId,
        { openingDate: v.openingDate || null, timezone: v.timezone || null, interests: v.interests, restrictions: v.restrictions, pauseReason: v.pauseReason, pauseUntil: v.pauseUntil || null },
        profilePath
      );
      setMsg(r.ok ? "Saved." : r.error ?? "Failed.");
      if (r.ok) router.refresh();
    });
  }

  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs text-gold hover:underline">
        {open ? "Hide follow-up settings" : "Edit follow-up settings (opening date, time zone, contact restrictions…)"}
      </button>
      {open && (
        <div className="mt-3 space-y-3 rounded border border-border p-3">
          <div className="flex flex-wrap gap-3">
            <div>
              <span className={lbl}>Original opening date (Morgan promo order entered)</span>
              <input type="date" value={v.openingDate} onChange={(e) => setV({ ...v, openingDate: e.target.value })} className={input} />
            </div>
            <div>
              <span className={lbl}>Client time zone</span>
              <select value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })} className={input}>
                {ZONES.map(([z, l]) => <option key={z} value={z}>{l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <span className={lbl}>Interests / preferred products</span>
            <input value={v.interests} onChange={(e) => setV({ ...v, interests: e.target.value })} className={`${input} w-full`} placeholder="e.g. Morgan silver, Double Eagles" />
          </div>
          <div>
            <span className={lbl}>Contact restrictions</span>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-foreground">
              {([
                ["noCalls", "No calls"],
                ["noTexts", "No texts"],
                ["noEmail", "No email"],
                ["noPromoEmail", "No promotional email"],
                ["doNotContact", "Asked to stop all contact"],
              ] as const).map(([k, t]) => (
                <label key={k} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={!!v.restrictions[k]} onChange={(e) => setR(k, e.target.checked)} className="h-4 w-4 accent-gold" /> {t}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1">
              <span className={lbl}>Pause reason (documents why there’s no next action)</span>
              <input value={v.pauseReason} onChange={(e) => setV({ ...v, pauseReason: e.target.value })} className={`${input} w-full`} placeholder="e.g. On vacation until the 20th" />
            </div>
            <div>
              <span className={lbl}>Pause until</span>
              <input type="date" value={v.pauseUntil} onChange={(e) => setV({ ...v, pauseUntil: e.target.value })} className={input} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={save} disabled={pending} className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-brand-black disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
            {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function AddTaskForm({ partyId, profilePath }: { partyId: string; profilePath: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [kind, setKind] = useState<"MANUAL" | "CALLBACK" | "SERVICE">("MANUAL");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    setMsg(null);
    startTransition(async () => {
      const r = await addTaskAction(partyId, purpose, date, kind === "CALLBACK" ? time : null, kind, key(), profilePath);
      if (!r.ok) return setMsg(r.error ?? "Failed.");
      setPurpose(""); setDate(""); setTime(""); setOpen(false);
      router.refresh();
    });
  }

  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs text-gold hover:underline">+ Add task / callback</button>;
  return (
    <div className="flex flex-wrap items-end gap-2 rounded border border-border p-2">
      <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={input}>
        <option value="MANUAL">Follow-up</option>
        <option value="CALLBACK">Promised callback (timed)</option>
        <option value="SERVICE">Service issue</option>
      </select>
      <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What needs to happen?" className={`${input} min-w-[12rem] flex-1`} />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
      {kind === "CALLBACK" && (
        <select value={time} onChange={(e) => setTime(e.target.value)} className={input}>
          <option value="">— time (ET) —</option>
          {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      )}
      <button type="button" disabled={pending || !purpose.trim() || !date || (kind === "CALLBACK" && !time)} onClick={add} className="rounded bg-gold px-3 py-1.5 text-xs font-medium text-brand-black disabled:opacity-50">Add</button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground">Cancel</button>
      {msg && <span className="text-xs text-red-600">{msg}</span>}
    </div>
  );
}
