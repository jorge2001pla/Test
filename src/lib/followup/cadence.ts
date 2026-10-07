/**
 * Configurable 30-day cadence. Pure: takes a cycle start date + rules, returns the dated plan.
 *
 * Default plan (editable in Settings → Follow-Up Rules):
 *   day 1  record the sale, conversation, interests, next action   (no outbound step)
 *   day 2  call + voicemail            day 4  call + identifying text (if permitted)
 *   day 6  call at a different local-time period
 *   day 8  call + relevant voicemail   day 10 call + relevant text (if permitted)
 *   day 12 call                        day 15 call + voicemail
 *   day 19 call                        day 24 call + short text (if permitted)
 *   day 30 final call + voicemail
 * = 10 calls, ≤ 4 voicemails, ≤ 3 texts. A voicemail belongs to its unanswered call.
 */
import {
  addDays,
  isWorkday,
  nextWorkdayOnOrAfter,
  prevWorkdayOnOrBefore,
  type DateStr,
  type WorkRules,
} from "./dates";
import { CYCLE_LENGTH_DAYS, cycleEnd } from "./commission";

export interface CadenceStep {
  /** Cycle day number (sale date = day 1). */
  day: number;
  call: boolean;
  voicemail: boolean;
  text: boolean;
  /** Call should be placed in a different local-time period than previous attempts. */
  differentPeriod?: boolean;
  /** Short human purpose shown on the task. */
  purpose: string;
}

export interface CadenceConfig {
  steps: CadenceStep[];
}

export const DEFAULT_CADENCE: CadenceConfig = {
  steps: [
    { day: 2, call: true, voicemail: true, text: false, purpose: "Thank-you / check-in call" },
    { day: 4, call: true, voicemail: false, text: true, purpose: "Follow-up call + identifying text" },
    { day: 6, call: true, voicemail: false, text: false, differentPeriod: true, purpose: "Call at a different time of day" },
    { day: 8, call: true, voicemail: true, text: false, purpose: "Call + relevant voicemail" },
    { day: 10, call: true, voicemail: false, text: true, purpose: "Call + relevant text" },
    { day: 12, call: true, voicemail: false, text: false, purpose: "Follow-up call" },
    { day: 15, call: true, voicemail: true, text: false, purpose: "Mid-cycle call + voicemail" },
    { day: 19, call: true, voicemail: false, text: false, purpose: "Follow-up call" },
    { day: 24, call: true, voicemail: false, text: true, purpose: "Call + short text" },
    { day: 30, call: true, voicemail: true, text: false, purpose: "Final cycle call + voicemail" },
  ],
};

/** Per-client channel permissions (derived from contact restrictions on the client). */
export interface ChannelPermissions {
  call: boolean;
  text: boolean;
  email: boolean;
  voicemail: boolean;
}

export const ALL_CHANNELS_ALLOWED: ChannelPermissions = { call: true, text: true, email: true, voicemail: true };

export function validateCadence(config: CadenceConfig): string[] {
  const errors: string[] = [];
  const seen = new Set<number>();
  for (const s of config.steps) {
    if (!Number.isInteger(s.day) || s.day < 2 || s.day > CYCLE_LENGTH_DAYS) {
      errors.push(`Step day ${s.day} must be a whole number from 2 to ${CYCLE_LENGTH_DAYS}.`);
    }
    if (seen.has(s.day)) errors.push(`Day ${s.day} appears more than once.`);
    seen.add(s.day);
    if (!s.call && !s.text) errors.push(`Day ${s.day} must include a call or a text.`);
    if (s.voicemail && !s.call) errors.push(`Day ${s.day}: a voicemail belongs to a call.`);
  }
  return errors;
}

export function summarizeCadence(config: CadenceConfig) {
  return {
    calls: config.steps.filter((s) => s.call).length,
    voicemails: config.steps.filter((s) => s.call && s.voicemail).length,
    texts: config.steps.filter((s) => s.text).length,
  };
}

export interface PlannedStep {
  /** Day of the cycle this step nominally belongs to (highest day when several merged). */
  day: number;
  /** Nominal calendar date for that day (before moving to a working day). */
  nominalDate: DateStr;
  /** Eastern business date the step is actually due (a workday, within the cycle). */
  dueDate: DateStr;
  call: boolean;
  voicemail: boolean;
  text: boolean;
  differentPeriod: boolean;
  purpose: string;
  /** Other cadence days folded into this one by a same-day collision. */
  mergedDays: number[];
  /** Stable per-cycle key — the dedupe key suffix for the generated task. */
  key: string;
}

export function stepKey(day: number): string {
  return `cad-${String(day).padStart(2, "0")}`;
}

/**
 * Builds the dated plan for a cycle. Moves non-working days to the next workday (or the previous
 * workday when that would pass the cycle's last day — moving a task never extends the clock) and
 * merges steps that collide on one date so there is never more than one outbound call per day.
 * Text is dropped where the client's permissions forbid it; steps with no remaining channel vanish.
 */
export function planCadence(
  cycleStart: DateStr,
  rules: WorkRules,
  config: CadenceConfig = DEFAULT_CADENCE,
  permissions: ChannelPermissions = ALL_CHANNELS_ALLOWED
): PlannedStep[] {
  const last = cycleEnd(cycleStart);
  const placed: PlannedStep[] = [];

  for (const step of [...config.steps].sort((a, b) => a.day - b.day)) {
    const call = step.call && permissions.call;
    const text = step.text && permissions.text;
    const voicemail = call && step.voicemail && permissions.voicemail;
    if (!call && !text) continue;

    const nominalDate = addDays(cycleStart, step.day - 1);
    let due = nextWorkdayOnOrAfter(nominalDate, rules);
    if (due > last) due = prevWorkdayOnOrBefore(last, rules);
    if (!isWorkday(due, rules) || due < cycleStart) continue; // no usable workday at all

    const prev = placed[placed.length - 1];
    if (prev && prev.dueDate === due) {
      // Same-day collision → one combined step; the later cadence day leads.
      prev.mergedDays.push(prev.day);
      prev.day = step.day;
      prev.nominalDate = nominalDate;
      prev.call = prev.call || call;
      prev.voicemail = prev.voicemail || voicemail;
      prev.text = prev.text || text;
      prev.differentPeriod = prev.differentPeriod || !!step.differentPeriod;
      prev.purpose = step.purpose;
      prev.key = stepKey(step.day);
      continue;
    }
    placed.push({
      day: step.day,
      nominalDate,
      dueDate: due,
      call,
      voicemail,
      text,
      differentPeriod: !!step.differentPeriod,
      purpose: step.purpose,
      mergedDays: [],
      key: stepKey(step.day),
    });
  }
  return placed;
}

/**
 * Among cadence steps already due (dueDate ≤ today) and still unresolved, only the LATEST is
 * actionable; older ones are "missed" — kept in history, never turned into catch-up calls.
 */
export function splitDueAndMissed<T extends { dueDate: DateStr }>(
  pendingSteps: T[],
  today: DateStr
): { actionable: T | null; missed: T[]; upcoming: T[] } {
  const sorted = [...pendingSteps].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const due = sorted.filter((s) => s.dueDate <= today);
  const upcoming = sorted.filter((s) => s.dueDate > today);
  const actionable = due.length ? due[due.length - 1] : null;
  return { actionable, missed: due.slice(0, -1), upcoming };
}

/** The first plan step strictly after `afterDate` (used for "next eligible step"). */
export function nextStepAfter(plan: PlannedStep[], afterDate: DateStr): PlannedStep | null {
  return plan.find((s) => s.dueDate > afterDate) ?? null;
}
