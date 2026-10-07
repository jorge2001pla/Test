"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logContactAction, recordSaleAction, type SalePayload } from "@/app/followup-actions";
import { CHANNEL_LABELS, OBJECTIONS, OUTCOME_LABELS, type Channel, type Outcome } from "@/lib/followup/outcomes";
import { TIME_OPTIONS } from "@/lib/time-options";

const input =
  "w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-gold focus:outline-none";
const label = "mb-1 block text-xs font-medium text-muted-foreground";

const CALL_OUTCOMES: Outcome[] = ["NO_ANSWER", "AI_SCREENING", "SHIPPING_UPDATE", "SPOKE", "CALLBACK_SET", "DECLINED", "SOLD", "STOP_CONTACT", "GHOST"];
const MSG_OUTCOMES: Outcome[] = ["SENT", "SHIPPING_UPDATE", "REPLIED", "STOP_CONTACT"];

const OUTCOME_STYLE: Partial<Record<Outcome, string>> = {
  NO_ANSWER: "border-yellow-500/60 text-yellow-700 dark:text-yellow-400",
  AI_SCREENING: "border-yellow-500/60 text-yellow-700 dark:text-yellow-400",
  CALLBACK_SET: "border-blue-500/60 text-blue-700 dark:text-blue-400",
  DECLINED: "border-red-500/60 text-red-700 dark:text-red-400",
  SOLD: "border-green-600/60 text-green-700 dark:text-green-400",
  DELIVERY_CONFIRMED: "border-green-600/60 text-green-700 dark:text-green-400",
  SHIPPING_UPDATE: "border-green-600/60 text-green-700 dark:text-green-400",
  GHOST: "border-border text-muted-foreground",
};

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}
function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
}

export interface LogDefaults {
  taskId?: string | null;
  shipmentId?: string | null;
  purpose?: string | null;
  channel?: Channel;
}

export default function LogContactPanel({
  partyId,
  name,
  mode = "contact",
  defaults = {},
  hasBook = false,
  openingKnown = true,
  profilePath,
  triggerLabel,
  triggerClass,
  showDelivery = false,
  initialOpen = false,
  onClose,
}: {
  partyId: string;
  name: string;
  mode?: "contact" | "sale";
  defaults?: LogDefaults;
  hasBook?: boolean;
  openingKnown?: boolean;
  profilePath?: string;
  triggerLabel?: string;
  triggerClass?: string;
  /** Offer “Delivery confirmed” as an outcome (when a delivery check-in is in play). */
  showDelivery?: boolean;
  /** Open immediately (used by wrappers that resolve the client first). */
  initialOpen?: boolean;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [open, setOpenRaw] = useState(initialOpen);
  const setOpen = (v: boolean) => {
    setOpenRaw(v);
    if (!v) onClose?.();
  };
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const keyRef = useRef(newKey());

  const [channel, setChannel] = useState<Channel>(defaults.channel ?? "DIALER_CALL");
  const [outcome, setOutcome] = useState<Outcome | null>(
    mode === "sale" ? "SOLD" : /order has shipped/i.test(defaults.purpose ?? "") ? "SHIPPING_UPDATE" : null
  );
  const [voicemail, setVoicemail] = useState(false);
  const [cbDate, setCbDate] = useState(etToday());
  const [cbTime, setCbTime] = useState("");
  const [objection, setObjection] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [nextNote, setNextNote] = useState("");
  const [pitch, setPitch] = useState("");
  const [notes, setNotes] = useState("");
  const [satisfaction, setSatisfaction] = useState("");

  // sale
  const [saleDate, setSaleDate] = useState(etToday());
  const [amount, setAmount] = useState("");
  const [profit, setProfit] = useState("");
  const [saleKind, setSaleKind] = useState<"SALE" | "PROMO_OPENER" | "OPENER_ONLY">("SALE");
  const [firstCall, setFirstCall] = useState(false);
  const [openingDate, setOpeningDate] = useState("");
  const [products, setProducts] = useState("");
  const [carrier, setCarrier] = useState("USPS");
  const [tracking, setTracking] = useState("");
  const [expected, setExpected] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenRaw(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const isCall = channel === "DIALER_CALL" || channel === "CELL_CALL";
  const outcomes: Outcome[] = isCall
    ? [...CALL_OUTCOMES, ...(showDelivery ? (["DELIVERY_CONFIRMED"] as Outcome[]) : [])]
    : MSG_OUTCOMES;

  function reset() {
    keyRef.current = newKey();
    setOutcome(mode === "sale" ? "SOLD" : null);
    setVoicemail(false); setObjection(""); setNextDate(""); setNextNote(""); setPitch(""); setNotes("");
    setCbTime(""); setAmount(""); setProfit(""); setTracking(""); setSatisfaction("");
  }

  function salePayload(): SalePayload {
    return {
      saleDate,
      amount: amount ? Number(amount) : null,
      profit: profit ? Number(profit) : null,
      kind: saleKind,
      firstCall,
      openingDate: openingDate || null,
      products: products || null,
      notes: notes || null,
      shipment: hasBook && tracking.trim() ? { carrier, trackingLink: tracking, expectedDelivery: expected || null } : null,
    };
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "contact" && !outcome) return setError("Pick what happened.");
    if (outcome === "DECLINED" && !objection) return setError("Pick the objection category.");
    if (outcome === "DECLINED" && !nextDate) return setError("Pick a next action date.");
    if (outcome === "SPOKE" && !nextDate) return setError("Pick a next action date.");
    if (outcome === "CALLBACK_SET" && (!cbDate || !cbTime)) return setError("Pick the callback date and time.");
    if ((mode === "sale" || outcome === "SOLD") && !saleDate) return setError("Enter the sale date.");
    startTransition(async () => {
      const res =
        mode === "sale"
          ? await recordSaleAction(partyId, salePayload(), keyRef.current, profilePath)
          : await logContactAction({
              partyId, channel, outcome: outcome as string, voicemailLeft: voicemail, taskId: defaults.taskId ?? null,
              shipmentId: defaults.shipmentId ?? null, purpose: defaults.purpose ?? null, pitch, objection, nextActionDate: nextDate || null,
              nextActionNote: nextNote, callbackDate: cbDate, callbackTime: cbTime, notes, satisfaction,
              sale: outcome === "SOLD" ? salePayload() : null, idemKey: keyRef.current, profilePath,
            });
      if (!res.ok) return setError(res.error ?? "Something went wrong.");
      setResult(res.message ?? "Saved.");
      window.dispatchEvent(new CustomEvent("prc-toast", { detail: `${name}: ${res.message ?? "Saved."}` }));
      reset();
      router.refresh();
    });
  }

  const showSale = mode === "sale" || outcome === "SOLD";

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setResult(null); setError(null); }}
        className={triggerClass ?? "rounded border border-gold px-2.5 py-1 text-xs font-medium text-gold transition-colors hover:bg-gold/10"}
      >
        {triggerLabel ?? (mode === "sale" ? "Record Sale" : "Log Contact")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form onSubmit={submit} className="my-8 w-full max-w-lg rounded-lg border border-border bg-card p-5 text-left shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-semibold text-foreground">{mode === "sale" ? "Record Sale" : "Log Contact"} — {name}</h3>
                {defaults.purpose && <p className="text-xs text-muted-foreground">For: {defaults.purpose}</p>}
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close">✕</button>
            </div>

            {result ? (
              <div className="mt-4 space-y-3">
                <p className="rounded border border-gold/40 bg-gold/10 p-3 text-sm text-foreground">{result}</p>
                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => { setResult(null); }} className="text-xs text-muted-foreground hover:text-foreground">Log another</button>
                  <button type="button" onClick={() => setOpen(false)} className="rounded bg-gold px-3 py-1.5 text-xs font-medium text-brand-black">Done</button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {mode === "contact" && (
                  <>
                    <div>
                      <span className={label}>How</span>
                      <div className="flex flex-wrap gap-1.5">
                        {(Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => (
                          <button key={c} type="button" onClick={() => { setChannel(c); setOutcome(null); }}
                            className={`rounded border px-2.5 py-1 text-xs ${channel === c ? "border-gold bg-gold/15 text-gold" : "border-border text-muted-foreground hover:border-gold"}`}>
                            {CHANNEL_LABELS[c]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className={label}>What happened</span>
                      <div className="flex flex-wrap gap-1.5">
                        {outcomes.map((o) => (
                          <button key={o} type="button" onClick={() => setOutcome(o)}
                            className={`rounded border px-2.5 py-1 text-xs font-medium ${outcome === o ? "bg-gold/15 ring-1 ring-gold" : "hover:bg-gold/5"} ${OUTCOME_STYLE[o] ?? "border-border text-foreground"}`}>
                            {OUTCOME_LABELS[o]}
                          </button>
                        ))}
                      </div>
                    </div>
                    {outcome === "NO_ANSWER" && isCall && (
                      <label className="flex items-center gap-2 text-sm text-foreground">
                        <input type="checkbox" checked={voicemail} onChange={(e) => setVoicemail(e.target.checked)} className="h-4 w-4 accent-gold" />
                        Left a voicemail (counts as part of this call)
                      </label>
                    )}
                    {outcome === "CALLBACK_SET" && (
                      <div className="flex gap-2">
                        <div className="flex-1"><span className={label}>Callback date (Eastern)</span><input type="date" value={cbDate} onChange={(e) => setCbDate(e.target.value)} className={input} /></div>
                        <div className="flex-1"><span className={label}>Time (Eastern)</span>
                          <select value={cbTime} onChange={(e) => setCbTime(e.target.value)} className={input}>
                            <option value="">— time —</option>
                            {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </div>
                      </div>
                    )}
                    {outcome === "DECLINED" && (
                      <div>
                        <span className={label}>Why (required)</span>
                        <select value={objection} onChange={(e) => setObjection(e.target.value)} className={input}>
                          <option value="">— pick one —</option>
                          {OBJECTIONS.filter((o) => o.key !== "NO_FURTHER_CONTACT").map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                        </select>
                        <p className="mt-1 text-xs text-muted-foreground">Declining an offer is not “stop contacting me” — use that outcome if they asked to be left alone.</p>
                      </div>
                    )}
                    {(outcome === "DECLINED" || outcome === "SPOKE") && (
                      <div className="flex gap-2">
                        <div className="flex-1"><span className={label}>Next action date (required)</span><input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className={input} /></div>
                        <div className="flex-[2]"><span className={label}>Next action</span><input value={nextNote} onChange={(e) => setNextNote(e.target.value)} placeholder="e.g. call about new Eagles" className={input} /></div>
                      </div>
                    )}
                    {outcome === "DELIVERY_CONFIRMED" && (
                      <div><span className={label}>Satisfaction (optional)</span><input value={satisfaction} onChange={(e) => setSatisfaction(e.target.value)} placeholder="Happy / concerns…" className={input} /></div>
                    )}
                    {outcome && ["SPOKE", "DECLINED", "CALLBACK_SET", "SOLD", "REPLIED"].includes(outcome) && (
                      <div><span className={label}>Pitch made (optional)</span><input value={pitch} onChange={(e) => setPitch(e.target.value)} placeholder="What you offered" className={input} /></div>
                    )}
                  </>
                )}

                {showSale && (
                  <div className="space-y-3 rounded border border-border p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sale</p>
                    <div className="flex flex-col gap-1 text-sm text-foreground">
                      {([
                        ["SALE", "My sale (starts a new 30-day cycle)"],
                        ["PROMO_OPENER", "Promo order — I opened this account"],
                        ["OPENER_ONLY", "$19.95 promo only — someone else opened (no new cycle)"],
                      ] as const).map(([k, t]) => (
                        <label key={k} className="flex items-center gap-2">
                          <input type="radio" name="saleKind" checked={saleKind === k} onChange={() => setSaleKind(k)} className="accent-gold" /> {t}
                        </label>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1"><span className={label}>Sale date</span><input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} className={input} /></div>
                      <div className="flex-1"><span className={label}>Amount ($)</span><input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className={input} /></div>
                      <div className="flex-1"><span className={label}>Profit ($)</span><input type="number" step="0.01" value={profit} onChange={(e) => setProfit(e.target.value)} className={input} /></div>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <input type="checkbox" checked={firstCall} onChange={(e) => setFirstCall(e.target.checked)} className="h-4 w-4 accent-gold" />
                      Closed on the first call (70% deal)
                    </label>
                    {!openingKnown && saleKind !== "PROMO_OPENER" && (
                      <div>
                        <span className={label}>Original opening date (when the Morgan promo order entered the company system)</span>
                        <input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} className={input} />
                        <p className="mt-1 text-xs text-muted-foreground">Unknown? Leave blank — commission eligibility will show “unknown” instead of guessing.</p>
                      </div>
                    )}
                    <div><span className={label}>Products / interests (optional)</span><input value={products} onChange={(e) => setProducts(e.target.value)} className={input} /></div>
                    {hasBook && (
                      <div className="space-y-2">
                        <span className={label}>Shipment (optional — you can add tracking later)</span>
                        <div className="flex gap-2">
                          <select value={carrier} onChange={(e) => setCarrier(e.target.value)} className={`${input} !w-24`}>
                            <option>USPS</option><option>FedEx</option><option>Other</option>
                          </select>
                          <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Tracking link" className={input} />
                        </div>
                        {tracking && <div><span className={label}>Expected delivery (estimate only)</span><input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className={input} /></div>}
                      </div>
                    )}
                  </div>
                )}

                <div><span className={label}>Notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={input} placeholder="Anything worth remembering" /></div>

                {error && <p className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">{error}</p>}
                <div className="flex justify-end gap-3 pt-1">
                  <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                  <button type="submit" disabled={pending} className="rounded bg-gold px-4 py-1.5 text-sm font-medium text-brand-black hover:opacity-90 disabled:opacity-50">
                    {pending ? "Saving…" : mode === "sale" ? "Record Sale" : "Save"}
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      )}
    </>
  );
}
