"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { dismissDuplicateAction, mergeAction } from "@/app/followup-actions";
import type { DuplicatePair, DuplicateSide } from "@/lib/followup/admin";

function Side({ s, keep, onKeep }: { s: DuplicateSide; keep: boolean; onKeep: () => void }) {
  return (
    <label className={`block cursor-pointer rounded border p-3 text-sm ${keep ? "border-gold bg-gold/10" : "border-border"}`}>
      <input type="radio" checked={keep} onChange={onKeep} className="mr-2 accent-gold" />
      <Link href={s.href} className="font-medium text-foreground hover:text-gold hover:underline">{s.name}</Link>
      <p className="mt-1 text-xs text-muted-foreground">
        {s.records} · {s.phones.join(", ") || "no phone"} · {s.email ?? "no email"}<br />
        Opening date: {s.openingDate ?? "unknown"} · {s.orders} orders · {s.contacts} contacts · {s.pendingTasks} open tasks{s.activeCycle ? " · active cycle" : ""}
      </p>
    </label>
  );
}

function Pair({ p }: { p: DuplicatePair }) {
  const router = useRouter();
  const [keepA, setKeepA] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string; conflicts?: string[] }>) =>
    startTransition(async () => {
      const r = await fn();
      setMsg(r.ok ? [r.message, ...(r.conflicts ?? [])].filter(Boolean).join(" · ") : r.error ?? "Failed.");
      if (r.ok) router.refresh();
    });
  return (
    <li className="space-y-2 rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{p.reasons.join(" + ")}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Side s={p.a} keep={keepA} onKeep={() => setKeepA(true)} />
        <Side s={p.b} keep={!keepA} onKeep={() => setKeepA(false)} />
      </div>
      {p.conflicts.length > 0 && <p className="text-xs text-orange-700 dark:text-orange-400">Check before merging: {p.conflicts.join("; ")}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending}
          onClick={() => confirm("Merge these two? Nothing is deleted — orders, contacts, tasks and shipments move to the one you keep.") &&
            run(() => keepA ? mergeAction(p.a.partyId, p.b.partyId) : mergeAction(p.b.partyId, p.a.partyId))}
          className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-brand-black disabled:opacity-50">Merge into the selected one</button>
        <button type="button" disabled={pending} onClick={() => run(() => dismissDuplicateAction(p.a.partyId, p.b.partyId))} className="text-sm text-muted-foreground hover:text-gold">Not the same person</button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
    </li>
  );
}

export default function DuplicateReview({ pairs }: { pairs: DuplicatePair[] }) {
  return <ul className="space-y-3">{pairs.map((p) => <Pair key={p.a.partyId + p.b.partyId} p={p} />)}</ul>;
}
