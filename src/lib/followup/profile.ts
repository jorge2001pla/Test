/** Everything the client profile's Follow-Up panel shows, in one read. */
import { commissionStatus, cycleDay, cycleEnd, windowDeadlineNeedsAttentionToday, type CommissionStatus } from "./commission";
import { etDate, formatLocalTime, type DateStr } from "./dates";
import { getConfig, getLinks, getParty, partyZone, q, type Party, type PartyLinks, type TaskRow } from "./store";

export interface ProfileView {
  party: Party;
  links: PartyLinks;
  today: DateStr;
  commission: CommissionStatus;
  deadlineWarning: boolean;
  cycle: { id: string; start: DateStr; end: DateStr; day: number; daysRemaining: number } | null;
  lastClosedCycle: { start: DateStr; end: DateStr; reason: string | null } | null;
  pending: TaskRow[];
  history: (TaskRow & { status_reason: string | null })[];
  orders: { id: string; sale_date: string; amount: number | null; profit: number | null; kind: string; commission_kind: string | null; commission_rate: number | null; qualifying: number }[];
  contacts: { id: string; occurred_at: string; channel: string; outcome: string; voicemail_left: number; reached: number; purpose: string | null; objection_category: string | null; pitch: string | null; notes: string | null }[];
  nextAction: TaskRow | null;
  timezone: { tz: string; known: boolean; local: string; source: string | null };
  hasBook: boolean;
}

export async function getProfileView(partyId: string, now: Date = new Date()): Promise<ProfileView | null> {
  const party = await getParty(partyId);
  if (!party) return null;
  const cfg = await getConfig();
  const today = etDate(now);
  const [links, cyc, closed, pending, history, orders, contacts] = await Promise.all([
    getLinks(party.id),
    q<{ id: string; start_date: string }>("SELECT id, start_date FROM fu_cycles WHERE party_id = ? AND status = 'ACTIVE'", [party.id]),
    q<{ start_date: string; end_date: string; close_reason: string | null }>(
      "SELECT start_date, end_date, close_reason FROM fu_cycles WHERE party_id = ? AND status = 'CLOSED' ORDER BY closed_at DESC LIMIT 1", [party.id]),
    q<TaskRow>("SELECT * FROM fu_tasks WHERE party_id = ? AND status = 'PENDING' ORDER BY COALESCE(due_at, due_date), created_at", [party.id]),
    q<TaskRow>("SELECT * FROM fu_tasks WHERE party_id = ? AND status != 'PENDING' ORDER BY status_at DESC LIMIT 12", [party.id]),
    q<ProfileView["orders"][number]>("SELECT * FROM fu_orders WHERE party_id = ? ORDER BY sale_date DESC, created_at DESC LIMIT 10", [party.id]),
    q<ProfileView["contacts"][number]>("SELECT * FROM fu_contacts WHERE party_id = ? ORDER BY occurred_at DESC LIMIT 12", [party.id]),
  ]);
  const zone = partyZone(party, cfg);
  const cycle = cyc[0]
    ? { id: cyc[0].id, start: cyc[0].start_date, end: cycleEnd(cyc[0].start_date), day: cycleDay(cyc[0].start_date, today), daysRemaining: Math.max(0, 31 - cycleDay(cyc[0].start_date, today)) }
    : null;
  return {
    party,
    links,
    today,
    commission: commissionStatus(party.openingDate, today),
    deadlineWarning: windowDeadlineNeedsAttentionToday(party.openingDate, today, cfg),
    cycle,
    lastClosedCycle: closed[0] ? { start: closed[0].start_date, end: closed[0].end_date, reason: closed[0].close_reason } : null,
    pending,
    history,
    orders,
    contacts,
    nextAction: pending.find((t) => ["CADENCE", "CALLBACK", "MANUAL", "REACTIVATION", "DELIVERY"].includes(t.category)) ?? null,
    timezone: {
      tz: zone.tz,
      known: zone.known,
      local: formatLocalTime(now, zone.tz),
      source: party.timezoneSource === "manual" ? "set by you" : zone.known ? "guessed from the area code" : null,
    },
    hasBook: !!links.bookClientId,
  };
}
