import LogContactPanel from "@/components/LogContactPanel";
import TaskActions from "@/components/TaskActions";
import TrackingForm from "@/components/TrackingForm";
import TrackingCheck from "@/components/TrackingCheck";
import PartySettingsForm, { AddTaskForm } from "@/components/PartySettingsForm";
import { getProfileView } from "@/lib/followup/profile";
import { commissionLine, fmtDate, fmtDay, fmtInstant } from "@/lib/followup/present";
import { CHANNEL_LABELS, OUTCOME_LABELS, type Channel, type Outcome } from "@/lib/followup/outcomes";

const TONE: Record<string, string> = {
  ok: "text-green-700 dark:text-green-400",
  warn: "text-orange-600 dark:text-orange-400",
  bad: "text-muted-foreground",
  muted: "text-muted-foreground",
};

const CLOSE_LABEL: Record<string, string> = {
  NO_RESPONSE: "closed — no response",
  CLOSED_MISSED_STEPS: "closed with missed steps",
  COMPLETED: "completed",
  RESTARTED: "restarted by a newer sale",
  GHOST: "closed — GHOST",
  DO_NOT_CONTACT: "closed — asked to stop contact",
  MERGED: "merged duplicate",
};

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 text-sm">
      <span className="w-28 shrink-0 text-muted-foreground">{k}</span>
      <span className="text-foreground">{children}</span>
    </div>
  );
}

/** Compact follow-up summary for one person: next action, where they are in the 30 days and the
 * 50% window, last contact, and what's open. Everything else lives under “More details”. */
export default async function FollowUpPanel({ partyId, profilePath }: { partyId: string; profilePath: string }) {
  const v = await getProfileView(partyId);
  if (!v) return null;
  const { party, commission, cycle } = v;
  const comm = commissionLine(commission);
  const r = party.restrictions;
  const next = v.nextAction;

  return (
    <div className="space-y-3 rounded-lg border border-gold/40 bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">30-Day Follow-Up</h2>
        <div className="flex flex-wrap items-center gap-2">
          <LogContactPanel partyId={party.id} name={party.displayName} openingKnown={!!party.openingDate} hasBook={v.hasBook} profilePath={profilePath} showDelivery={v.pending.some((t) => t.category === "DELIVERY")} />
          <LogContactPanel partyId={party.id} name={party.displayName} mode="sale" openingKnown={!!party.openingDate} hasBook={v.hasBook} profilePath={profilePath} triggerClass="rounded bg-gold px-2.5 py-1 text-xs font-medium text-brand-black hover:opacity-90" />
        </div>
      </div>

      {(party.ghost || r.doNotContact) && (
        <p className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {party.ghost ? "GHOST — outreach is suppressed." : "Asked to stop all contact — outreach is suppressed."}
        </p>
      )}
      {v.deadlineWarning && (
        <p className="rounded bg-orange-500/10 px-3 py-2 text-sm text-orange-700 dark:text-orange-400">
          The 50% window ends on a non-working day — today is the last working day to act in-window.
        </p>
      )}

      <div className="space-y-1">
        <Row k="Next action">
          {next ? (
            <b>
              {next.purpose}{" "}
              <span className="font-normal text-muted-foreground">— {next.due_at ? fmtInstant(next.due_at) : fmtDate(next.due_date)}</span>
            </b>
          ) : party.pauseReason ? (
            <span className="text-muted-foreground">Paused: {party.pauseReason}</span>
          ) : (
            <span className="text-orange-700 dark:text-orange-400">None scheduled</span>
          )}
        </Row>
        <Row k="30-day cycle">
          {cycle ? (
            <>Day <b>{Math.min(cycle.day, 30)}</b> of 30 <span className="text-muted-foreground">(ends {fmtDate(cycle.end)})</span></>
          ) : v.lastClosedCycle ? (
            <span className="text-muted-foreground">None active — last one {CLOSE_LABEL[v.lastClosedCycle.reason ?? ""] ?? v.lastClosedCycle.reason}</span>
          ) : (
            <span className="text-muted-foreground">None yet — record a sale to start one</span>
          )}
        </Row>
        <Row k="50% window"><span className={TONE[comm.tone]}>{comm.text.replace("Commission window: ", "")}</span></Row>
        <Row k="Last contact">
          <span className="text-muted-foreground">attempt {fmtDay(party.lastAttemptAt)} · conversation {fmtDay(party.lastConversationAt)}</span>
        </Row>
      </div>

      {v.pending.length > 0 && (
        <ul className="divide-y divide-border rounded border border-border">
          {v.pending.slice(0, 4).map((t) => (
            <li key={t.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
              <div className="text-sm text-foreground">
                {t.purpose}
                <span className="ml-2 text-xs text-muted-foreground">
                  {t.due_at ? fmtInstant(t.due_at) : fmtDate(t.due_date)}
                  {t.due_date < v.today && <b className="ml-1 text-red-600 dark:text-red-400">overdue</b>}
                </span>
              </div>
              <div className="space-y-1">
                {t.category === "SHIPMENT" && t.type === "TASK" && !t.shipment_id && t.order_id && <TrackingForm orderId={t.order_id} profilePath={profilePath} />}
                {t.category === "SHIPMENT" && t.type === "TASK" && t.shipment_id && <TrackingCheck shipmentId={t.shipment_id} trackingLink={t.detail} profilePath={profilePath} />}
                <TaskActions taskId={t.id} timed={t.category === "CALLBACK"} />
              </div>
            </li>
          ))}
          {v.pending.length > 4 && (
            <li className="px-3 py-1.5 text-xs text-muted-foreground">+ {v.pending.length - 4} more scheduled steps (they appear in your queue when due)</li>
          )}
        </ul>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-gold hover:underline">More details &amp; settings</summary>
        <div className="mt-3 space-y-4">
          <div className="space-y-1">
            <Row k="Opening date">{party.openingDate ? fmtDate(party.openingDate) : <span className="text-muted-foreground">unknown</span>}</Row>
            <Row k="Window ends">{commission.windowEnd ? fmtDate(commission.windowEnd) : "—"} <span className="text-xs text-muted-foreground">(repeat sales never extend it)</span></Row>
            <Row k="Last sale">{party.latestQualifyingSaleDate ? fmtDate(party.latestQualifyingSaleDate) : "—"}</Row>
            <Row k="Their local time">{v.timezone.local}{!v.timezone.known && " (zone unknown — using Eastern)"}{v.timezone.source && ` · ${v.timezone.source}`}</Row>
            <Row k="Interests">{party.interests || <span className="text-muted-foreground">—</span>}</Row>
            <Row k="Last pitch">{party.lastPitch || <span className="text-muted-foreground">—</span>}</Row>
            <Row k="Last objection">{party.lastObjection || <span className="text-muted-foreground">—</span>}</Row>
            <Row k="Restrictions">{[r.noCalls && "no calls", r.noTexts && "no texts", r.noEmail && "no email", r.noPromoEmail && "no promo email", r.doNotContact && "STOP ALL"].filter(Boolean).join(", ") || <span className="text-muted-foreground">none</span>}</Row>
          </div>

          <AddTaskForm partyId={party.id} profilePath={profilePath} />

          <PartySettingsForm
            partyId={party.id}
            profilePath={profilePath}
            initial={{ openingDate: party.openingDate ?? "", timezone: party.timezone ?? "", interests: party.interests ?? "", restrictions: party.restrictions, pauseReason: party.pauseReason ?? "", pauseUntil: party.pauseUntil ?? "" }}
          />

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Orders</p>
              {v.orders.length === 0 ? <p className="text-muted-foreground">None recorded.</p> : (
                <ul className="space-y-1">
                  {v.orders.map((o) => (
                    <li key={o.id} className="text-foreground">
                      {fmtDate(o.sale_date)} · {o.amount != null ? `$${o.amount}` : "—"}
                      <span className="text-xs text-muted-foreground"> {o.qualifying ? (o.commission_kind ?? "").replace("_", " ").toLowerCase() : "opener-only"}{o.commission_rate ? ` @ ${o.commission_rate * 100}%` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contacts</p>
              {v.contacts.length === 0 ? <p className="text-muted-foreground">None logged here yet (older calls are in the call log below).</p> : (
                <ul className="space-y-1">
                  {v.contacts.map((c) => (
                    <li key={c.id} className="text-foreground">
                      {fmtInstant(c.occurred_at)} · {CHANNEL_LABELS[c.channel as Channel] ?? c.channel} · {OUTCOME_LABELS[c.outcome as Outcome] ?? c.outcome}{c.voicemail_left ? " + VM" : ""}
                      <span className="text-xs text-muted-foreground"> {c.reached ? "(conversation)" : "(attempt)"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Closed tasks</p>
              {v.history.length === 0 ? <p className="text-muted-foreground">None.</p> : (
                <ul className="space-y-1">
                  {v.history.map((t) => (
                    <li key={t.id} className="text-foreground">
                      <span className="text-xs uppercase text-muted-foreground">{t.status.toLowerCase()}</span> {t.purpose}
                      {t.status_reason && <span className="text-xs text-muted-foreground"> — {t.status_reason}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
