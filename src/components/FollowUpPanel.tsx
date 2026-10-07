import LogContactPanel from "@/components/LogContactPanel";
import TaskActions from "@/components/TaskActions";
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
  NO_RESPONSE: "Closed — no response",
  CLOSED_MISSED_STEPS: "Closed with missed steps",
  COMPLETED: "Completed",
  RESTARTED: "Restarted by a newer sale",
  GHOST: "Closed — GHOST",
  DO_NOT_CONTACT: "Closed — asked to stop contact",
  MERGED: "Merged duplicate",
};

function Item({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** The canonical follow-up picture for one person: two separate clocks, next action, tasks,
 * restrictions, orders and contact history. Shared by the 50% and Book profiles. */
export default async function FollowUpPanel({ partyId, profilePath }: { partyId: string; profilePath: string }) {
  const v = await getProfileView(partyId);
  if (!v) return null;
  const { party, commission, cycle } = v;
  const comm = commissionLine(commission);
  const r = party.restrictions;

  return (
    <div className="space-y-4 rounded-lg border border-gold/40 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-foreground">30-Day Follow-Up</h2>
          <p className="text-sm text-muted-foreground">
            Their time: {v.timezone.local}
            {!v.timezone.known && " (zone unknown — using Eastern)"}
            {v.timezone.source && ` · ${v.timezone.source}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LogContactPanel partyId={party.id} name={party.displayName} openingKnown={!!party.openingDate} hasBook={v.hasBook} profilePath={profilePath} showDelivery={v.pending.some((t) => t.category === "DELIVERY")} />
          <LogContactPanel partyId={party.id} name={party.displayName} mode="sale" openingKnown={!!party.openingDate} hasBook={v.hasBook} profilePath={profilePath} triggerClass="rounded bg-gold px-2.5 py-1 text-xs font-medium text-brand-black hover:opacity-90" />
        </div>
      </div>

      {(party.ghost || r.doNotContact) && (
        <p className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {party.ghost ? "GHOST — outreach and reactivation are suppressed." : "Asked to stop all contact — outreach is suppressed."} Unresolved orders and service issues stay visible.
        </p>
      )}
      {v.deadlineWarning && (
        <p className="rounded bg-orange-500/10 px-3 py-2 text-sm text-orange-700 dark:text-orange-400">
          The 50% window ends on a non-working day ({fmtDate(commission.windowEnd)}) — today is the last working day to act in-window.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded border border-border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold">Commission clock (what pays 70 / 50 / 17.5%)</p>
          <dl className="mt-2 space-y-2">
            <Item k="Original opening date">{party.openingDate ? fmtDate(party.openingDate) : <span className="text-muted-foreground">unknown</span>}{party.openingDateSource && party.openingDate ? <span className="text-xs text-muted-foreground"> ({party.openingDateSource})</span> : null}</Item>
            <Item k="Commission window ends">{commission.windowEnd ? fmtDate(commission.windowEnd) : "—"}</Item>
            <Item k="Eligibility today"><span className={TONE[comm.tone]}>{comm.text}</span></Item>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">Repeat purchases never extend this window.</p>
        </div>
        <div className="rounded border border-border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold">Follow-up cycle (30 days from each sale)</p>
          <dl className="mt-2 space-y-2">
            <Item k="Latest qualifying sale">{party.latestQualifyingSaleDate ? fmtDate(party.latestQualifyingSaleDate) : "—"}</Item>
            <Item k="Cycle">
              {cycle ? <>Day <b>{Math.min(cycle.day, 30)}</b> of 30 · {fmtDate(cycle.start)} → {fmtDate(cycle.end)}</> : v.lastClosedCycle ? <span className="text-muted-foreground">No active cycle — last: {CLOSE_LABEL[v.lastClosedCycle.reason ?? ""] ?? v.lastClosedCycle.reason} ({fmtDate(v.lastClosedCycle.start)} → {fmtDate(v.lastClosedCycle.end)})</span> : <span className="text-muted-foreground">No cycle yet — record a sale to start one</span>}
            </Item>
            <Item k="Next action">{v.nextAction ? <>{v.nextAction.purpose} <span className="text-muted-foreground">— {v.nextAction.due_at ? fmtInstant(v.nextAction.due_at) : fmtDate(v.nextAction.due_date)}</span></> : party.pauseReason ? <span className="text-muted-foreground">Paused: {party.pauseReason}{party.pauseUntil ? ` (until ${fmtDate(party.pauseUntil)})` : ""}</span> : <span className="text-orange-700 dark:text-orange-400">None scheduled</span>}</Item>
          </dl>
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <Item k="Last contact attempt">{fmtDay(party.lastAttemptAt)}</Item>
        <Item k="Last actual conversation">{fmtDay(party.lastConversationAt)}</Item>
        <Item k="Interests">{party.interests || <span className="text-muted-foreground">—</span>}</Item>
        <Item k="Most recent pitch">{party.lastPitch || <span className="text-muted-foreground">—</span>}</Item>
        <Item k="Most recent objection">{party.lastObjection || <span className="text-muted-foreground">—</span>}</Item>
        <Item k="Contact restrictions">{[r.noCalls && "no calls", r.noTexts && "no texts", r.noEmail && "no email", r.noPromoEmail && "no promo email", r.doNotContact && "STOP ALL"].filter(Boolean).join(", ") || <span className="text-muted-foreground">none</span>}</Item>
      </dl>

      <div>
        <h3 className="text-sm font-semibold text-foreground">Open tasks</h3>
        {v.pending.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Nothing pending.</p>
        ) : (
          <ul className="mt-1 divide-y divide-border rounded border border-border">
            {v.pending.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                <div className="text-sm text-foreground">
                  {t.purpose}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {t.category.toLowerCase()} · due {t.due_at ? fmtInstant(t.due_at) : fmtDate(t.due_date)}
                    {t.due_date < v.today && <b className="ml-1 text-red-600 dark:text-red-400">overdue</b>}
                  </span>
                </div>
                <TaskActions taskId={t.id} timed={t.category === "CALLBACK"} />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <AddTaskForm partyId={party.id} profilePath={profilePath} />
        </div>
      </div>

      <PartySettingsForm
        partyId={party.id}
        profilePath={profilePath}
        initial={{ openingDate: party.openingDate ?? "", timezone: party.timezone ?? "", interests: party.interests ?? "", restrictions: party.restrictions, pauseReason: party.pauseReason ?? "", pauseUntil: party.pauseUntil ?? "" }}
      />

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-foreground">Orders, contacts &amp; task history</summary>
        <div className="mt-2 grid gap-4 md:grid-cols-3">
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
      </details>
    </div>
  );
}
