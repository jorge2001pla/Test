"use client";

import { useState, useTransition } from "react";
import { applyBackfillAction, previewBackfillAction, saveConfigAction } from "@/app/followup-actions";
import type { BackfillPreview, BackfillResult } from "@/lib/followup/admin";
import { DEFAULT_CADENCE, summarizeCadence, validateCadence, type CadenceStep } from "@/lib/followup/cadence";
import type { FollowUpConfig } from "@/lib/followup/config";

const input = "rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-gold focus:outline-none";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function FollowUpSettingsForm({ initial }: { initial: FollowUpConfig }) {
  const [cfg, setCfg] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<BackfillPreview | null>(null);
  const [result, setResult] = useState<BackfillResult | null>(null);

  const steps = cfg.cadence.steps;
  const setStep = (i: number, p: Partial<CadenceStep>) =>
    setCfg({ ...cfg, cadence: { steps: steps.map((s, j) => (j === i ? { ...s, ...p } : s)) } });
  const errors = validateCadence(cfg.cadence);
  const sum = summarizeCadence(cfg.cadence);

  return (
    <div className="space-y-8">
      <section className="space-y-3 rounded-lg border border-border bg-card p-5">
        <h2 className="font-display text-lg font-semibold text-foreground">Cadence (days after a sale)</h2>
        <p className="text-sm text-muted-foreground">Day 1 is the sale date (record the sale, conversation, interests and next action). Changes apply to cycles started from now on.</p>
        <table className="text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="pr-3">Day</th><th className="pr-3">Call</th><th className="pr-3">Voicemail</th><th className="pr-3">Text</th><th className="pr-3">Different time of day</th><th className="pr-3">Purpose</th><th /></tr></thead>
          <tbody>
            {steps.map((s, i) => (
              <tr key={i}>
                <td className="pr-3"><input type="number" min={2} max={30} value={s.day} onChange={(e) => setStep(i, { day: Number(e.target.value) })} className={`${input} w-16`} /></td>
                <td className="pr-3"><input type="checkbox" checked={s.call} onChange={(e) => setStep(i, { call: e.target.checked, voicemail: e.target.checked && s.voicemail })} className="h-4 w-4 accent-gold" /></td>
                <td className="pr-3"><input type="checkbox" checked={s.voicemail} disabled={!s.call} onChange={(e) => setStep(i, { voicemail: e.target.checked })} className="h-4 w-4 accent-gold" /></td>
                <td className="pr-3"><input type="checkbox" checked={s.text} onChange={(e) => setStep(i, { text: e.target.checked })} className="h-4 w-4 accent-gold" /></td>
                <td className="pr-3"><input type="checkbox" checked={!!s.differentPeriod} onChange={(e) => setStep(i, { differentPeriod: e.target.checked })} className="h-4 w-4 accent-gold" /></td>
                <td className="pr-3"><input value={s.purpose} onChange={(e) => setStep(i, { purpose: e.target.value })} className={`${input} w-64`} /></td>
                <td><button type="button" onClick={() => setCfg({ ...cfg, cadence: { steps: steps.filter((_, j) => j !== i) } })} className="text-xs text-muted-foreground hover:text-red-600">remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-3 text-sm">
          <button type="button" onClick={() => setCfg({ ...cfg, cadence: { steps: [...steps, { day: 3, call: true, voicemail: false, text: false, purpose: "Follow-up call" }] } })} className="text-gold hover:underline">+ Add step</button>
          <button type="button" onClick={() => setCfg({ ...cfg, cadence: DEFAULT_CADENCE })} className="text-muted-foreground hover:text-gold">Reset to default</button>
          <span className="text-muted-foreground">{sum.calls} calls · {sum.voicemails} voicemails · {sum.texts} texts</span>
        </div>
        {errors.map((e) => <p key={e} className="text-sm text-red-600">{e}</p>)}
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-5">
        <h2 className="font-display text-lg font-semibold text-foreground">Working days &amp; calling hours</h2>
        <div className="flex flex-wrap gap-4 text-sm text-foreground">
          {DAYS.map((d, i) => (
            <label key={d} className="flex items-center gap-1.5">
              <input type="checkbox" checked={cfg.workdays.includes(i)} onChange={(e) => setCfg({ ...cfg, workdays: e.target.checked ? [...cfg.workdays, i] : cfg.workdays.filter((x) => x !== i) })} className="h-4 w-4 accent-gold" /> {d}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-4 text-sm">
          <label>Calling starts (client local)<br /><input type="time" value={cfg.callingStart} onChange={(e) => setCfg({ ...cfg, callingStart: e.target.value })} className={input} /></label>
          <label>Calling ends<br /><input type="time" value={cfg.callingEnd} onChange={(e) => setCfg({ ...cfg, callingEnd: e.target.value })} className={input} /></label>
          <label>Callback heads-up (minutes before)<br /><input type="number" min={0} value={cfg.callbackLeadMinutes} onChange={(e) => setCfg({ ...cfg, callbackLeadMinutes: Number(e.target.value) })} className={`${input} w-24`} /></label>
          <label>“Has it been delivered?” reminder (days after tracking)<br /><input type="number" min={1} max={30} value={cfg.trackingCheckDays} onChange={(e) => setCfg({ ...cfg, trackingCheckDays: Number(e.target.value) })} className={`${input} w-24`} /></label>
          <label>Overdue after (minutes)<br /><input type="number" min={0} value={cfg.callbackGraceMinutes} onChange={(e) => setCfg({ ...cfg, callbackGraceMinutes: Number(e.target.value) })} className={`${input} w-24`} /></label>
        </div>
        <label className="block text-sm">Holidays / days off (one YYYY-MM-DD per line)<br />
          <textarea rows={3} value={cfg.holidays.join("\n")} onChange={(e) => setCfg({ ...cfg, holidays: e.target.value.split(/\s+/).filter(Boolean) })} className={`${input} w-48`} />
        </label>
        <div className="flex flex-wrap gap-5 text-sm text-foreground">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={cfg.companyRules.allowTexts} onChange={(e) => setCfg({ ...cfg, companyRules: { ...cfg.companyRules, allowTexts: e.target.checked } })} className="h-4 w-4 accent-gold" /> Company allows texts</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={cfg.companyRules.allowVoicemails} onChange={(e) => setCfg({ ...cfg, companyRules: { ...cfg.companyRules, allowVoicemails: e.target.checked } })} className="h-4 w-4 accent-gold" /> Company allows voicemails</label>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button type="button" disabled={pending || errors.length > 0} onClick={() => startTransition(async () => { const r = await saveConfigAction(cfg); setMsg(r.message ?? r.error ?? ""); })} className="rounded bg-gold px-4 py-2 text-sm font-medium text-brand-black disabled:opacity-50">Save rules</button>
        {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
      </div>

      <section className="space-y-3 rounded-lg border border-gold/40 bg-card p-5">
        <h2 className="font-display text-lg font-semibold text-foreground">Set up from your existing data (one time)</h2>
        <p className="text-sm text-muted-foreground">Preview first. It links records into one client each, imports known sales, and starts cycles only for sales in the last 30 days with future steps only. It never invents past calls, never creates catch-up calls, and never merges duplicates.</p>
        <button type="button" disabled={pending} onClick={() => startTransition(async () => { setResult(null); setPreview(await previewBackfillAction()); })} className="rounded border border-gold px-3 py-1.5 text-sm font-medium text-gold hover:bg-gold/10">Preview (changes nothing)</button>
        {preview && (
          <div className="space-y-2 text-sm text-foreground">
            <ul className="list-disc pl-5">
              <li>{preview.records.clients} 50%-list clients, {preview.records.bookClients} book clients, {preview.records.linkedPairs} already linked</li>
              <li>{preview.partiesToCreate} canonical clients to create</li>
              <li>{preview.ordersFromShipments} orders from priced shipments, {preview.ordersFromOwnerOpenedPromos} from promos you opened</li>
              <li><b>{preview.cyclesToStartTotal}</b> 30-day cycles to start (sales in the last 30 days); {preview.olderSalesNoCycle} older sales get no cycle</li>
              <li>{preview.shippedCallTasks} shipped-call tasks and {preview.deliveryTasks} delivery check-ins (recent only)</li>
              <li>{preview.legacyCallbacksToImport} existing callbacks imported as tasks</li>
              <li>{preview.duplicateCandidates} possible duplicates to review afterwards</li>
            </ul>
            {preview.cyclesToStart.length > 0 && (
              <details><summary className="cursor-pointer text-gold">Cycles that would start</summary>
                <ul className="mt-1 text-xs text-muted-foreground">{preview.cyclesToStart.map((c, i) => <li key={i}>{c.partyName} — sale {c.saleDate}, day {c.day}, {c.remainingSteps} steps left</li>)}</ul>
              </details>
            )}
            <ul className="list-disc pl-5 text-xs text-muted-foreground">{preview.notDone.map((n) => <li key={n}>{n}</li>)}</ul>
            <button type="button" disabled={pending} onClick={() => confirm("Apply the setup shown in the preview? It is safe to run again.") && startTransition(async () => setResult(await applyBackfillAction()))} className="rounded bg-gold px-4 py-2 text-sm font-medium text-brand-black">Apply setup</button>
          </div>
        )}
        {result && <p className="rounded bg-gold/10 p-3 text-sm text-foreground">Done: {result.parties} clients linked, {result.orders} orders, {result.cycles} cycles, {result.tasks} tasks, {result.callbacksImported} callbacks imported.</p>}
      </section>
    </div>
  );
}
