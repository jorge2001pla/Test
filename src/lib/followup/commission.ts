/**
 * Commission window vs. follow-up cycle — two SEPARATE clocks. Never substitute one for the other.
 *
 *  Commission clock (what pays 70 / 50 / 17.5 %):
 *    starts when the original promo order enters the company system. Opening date = day 1,
 *    day 15 = opening + 14. Repeat purchases NEVER extend it.
 *  Follow-up cycle clock (how long we work a client after a sale):
 *    every qualifying sale restarts it. Sale date = day 1, day 30 = sale date + 29.
 */
import { addDays, diffDays, isWorkday, prevWorkdayOnOrBefore, type DateStr, type WorkRules } from "./dates";

export const COMMISSION_WINDOW_DAYS = 15; // inclusive: opening date is day 1, day 15 = opening + 14
export const CYCLE_LENGTH_DAYS = 30; // inclusive: sale date is day 1, day 30 = sale + 29

export const RATE_FIRST_CALL = 0.7;
export const RATE_IN_WINDOW = 0.5;
export const RATE_AFTER_WINDOW = 0.175;

// ── Commission window ─────────────────────────────────────────────────────

/** Last day (inclusive) on which a sale still earns the in-window rate, or null if unknown. */
export function commissionWindowEnd(openingDate: DateStr | null | undefined): DateStr | null {
  return openingDate ? addDays(openingDate, COMMISSION_WINDOW_DAYS - 1) : null;
}

/** Window day number for `today` (opening date = day 1). May exceed 15. Null when unknown. */
export function windowDay(openingDate: DateStr | null | undefined, today: DateStr): number | null {
  return openingDate ? diffDays(openingDate, today) + 1 : null;
}

export type CommissionEligibility = "IN_WINDOW" | "EXPIRED" | "NOT_STARTED" | "UNKNOWN";

export interface CommissionStatus {
  eligibility: CommissionEligibility;
  openingDate: DateStr | null;
  windowEnd: DateStr | null;
  /** Window day (1–15 while in window). */
  day: number | null;
  /** Calendar days left INCLUDING today; 1 = today is the last in-window day. 0 when expired. */
  daysRemaining: number | null;
  /** Rate a sale made today would pay (given it is not a first-call deal). Null when unknown. */
  rateToday: number | null;
}

export function commissionStatus(openingDate: DateStr | null | undefined, today: DateStr): CommissionStatus {
  if (!openingDate) {
    return {
      eligibility: "UNKNOWN",
      openingDate: null,
      windowEnd: null,
      day: null,
      daysRemaining: null,
      rateToday: null,
    };
  }
  const windowEnd = commissionWindowEnd(openingDate)!;
  const day = windowDay(openingDate, today)!;
  if (day < 1) {
    return { eligibility: "NOT_STARTED", openingDate, windowEnd, day, daysRemaining: COMMISSION_WINDOW_DAYS, rateToday: null };
  }
  if (day > COMMISSION_WINDOW_DAYS) {
    return { eligibility: "EXPIRED", openingDate, windowEnd, day, daysRemaining: 0, rateToday: RATE_AFTER_WINDOW };
  }
  return {
    eligibility: "IN_WINDOW",
    openingDate,
    windowEnd,
    day,
    daysRemaining: COMMISSION_WINDOW_DAYS - day + 1,
    rateToday: RATE_IN_WINDOW,
  };
}

export type SaleKind = "FIRST_CALL" | "IN_WINDOW" | "AFTER_WINDOW" | "UNKNOWN";

/**
 * Commission tier of a sale. `firstCall` is set by the user when the deal closed on the opening
 * call. An unknown opening date yields UNKNOWN rather than a guess.
 */
export function classifySale(
  saleDate: DateStr,
  openingDate: DateStr | null | undefined,
  firstCall = false
): { kind: SaleKind; rate: number | null } {
  if (firstCall) return { kind: "FIRST_CALL", rate: RATE_FIRST_CALL };
  if (!openingDate) return { kind: "UNKNOWN", rate: null };
  const day = windowDay(openingDate, saleDate)!;
  if (day <= COMMISSION_WINDOW_DAYS) return { kind: "IN_WINDOW", rate: RATE_IN_WINDOW };
  return { kind: "AFTER_WINDOW", rate: RATE_AFTER_WINDOW };
}

export function commissionOnProfit(profit: number, rate: number | null): number | null {
  return rate == null ? null : Math.round(profit * rate * 100) / 100;
}

/**
 * Deadline warning: the commission window's last day is a nonworking day (or the day(s) right
 * before it are), so the last chance to work the client in-window is an EARLIER workday.
 * Returns that last usable workday when the window ends on/after a nonworking stretch; null when
 * the window end itself is a workday (nothing special) or the window is unknown/expired.
 *
 * Moving a task to a working slot never extends the window — this only tells the owner the
 * date by which they must act.
 */
export function lastWorkdayBeforeWindowEnd(
  openingDate: DateStr | null | undefined,
  rules: WorkRules
): DateStr | null {
  const end = commissionWindowEnd(openingDate);
  if (!end) return null;
  if (isWorkday(end, rules)) return null;
  return prevWorkdayOnOrBefore(end, rules);
}

/** True when today is the last workday on which the in-window rate is still reachable AND the
 * window ends on a nonworking day (e.g. window ends Sunday → Friday is the real deadline). */
export function windowDeadlineNeedsAttentionToday(
  openingDate: DateStr | null | undefined,
  today: DateStr,
  rules: WorkRules
): boolean {
  const end = commissionWindowEnd(openingDate);
  if (!end || today > end) return false;
  const last = lastWorkdayBeforeWindowEnd(openingDate, rules);
  return last != null && today === last;
}

// ── Follow-up cycle ───────────────────────────────────────────────────────

export function cycleEnd(startDate: DateStr): DateStr {
  return addDays(startDate, CYCLE_LENGTH_DAYS - 1);
}

/** Cycle day number for `today` (sale date = day 1). Can exceed 30 once the cycle has ended. */
export function cycleDay(startDate: DateStr, today: DateStr): number {
  return diffDays(startDate, today) + 1;
}

export function cycleDaysRemaining(startDate: DateStr, today: DateStr): number {
  return Math.max(0, CYCLE_LENGTH_DAYS - cycleDay(startDate, today) + 1);
}

/** The cycle is over once today is past day 30 (day 30 itself is still a working day). */
export function cycleHasEnded(startDate: DateStr, today: DateStr): boolean {
  return cycleDay(startDate, today) > CYCLE_LENGTH_DAYS;
}
