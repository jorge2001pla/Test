"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { dismissReactivationAction, selectReactivationAction } from "@/app/followup-actions";
import type { ReactivationRow } from "@/lib/followup/admin";

export default function ReactivationReview({ rows }: { rows: ReactivationRow[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSel(n);
  };
  const act = (fn: (ids: string[]) => Promise<{ message?: string }>) =>
    startTransition(async () => {
      const r = await fn([...sel]);
      setMsg(r.message ?? "Done.");
      setSel(new Set());
      router.refresh();
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending || sel.size === 0} onClick={() => act(selectReactivationAction)} className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-brand-black disabled:opacity-50">
          Add {sel.size || ""} selected to my queue
        </button>
        <button type="button" disabled={pending || sel.size === 0} onClick={() => act(dismissReactivationAction)} className="rounded border border-border px-3 py-1.5 text-sm text-muted-foreground disabled:opacity-50">
          Dismiss selected
        </button>
        <button type="button" onClick={() => setSel(new Set(rows.map((r) => r.partyId)))} className="text-xs text-gold hover:underline">Select all on this page</button>
        {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-background text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-3 py-2" /><th className="px-3 py-2">Client</th><th className="px-3 py-2">Phone</th><th className="px-3 py-2">Last sale</th><th className="px-3 py-2">Last objection</th><th className="px-3 py-2">Value</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.partyId} className="hover:bg-gold/5">
                <td className="px-3 py-2"><input type="checkbox" checked={sel.has(r.partyId)} onChange={() => toggle(r.partyId)} className="h-4 w-4 accent-gold" /></td>
                <td className="px-3 py-2"><Link href={r.href} className="font-medium text-foreground hover:text-gold hover:underline">{r.name}</Link></td>
                <td className="px-3 py-2 text-muted-foreground">{r.phone ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.lastSale ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.lastObjection ?? "—"}</td>
                <td className="px-3 py-2 text-foreground">${Math.round(r.lifetimeValue).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
