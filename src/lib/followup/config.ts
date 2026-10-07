/** Editable follow-up rules (stored as JSON in fu_settings). Pure — no database import. */
import { DEFAULT_CADENCE, validateCadence, type CadenceConfig, type ChannelPermissions } from "./cadence";
import { isDateStr, type CallingRules } from "./dates";

export interface FollowUpConfig extends CallingRules {
  cadence: CadenceConfig;
  /** Fallback zone for clients whose zone is unknown. */
  defaultTimezone: string;
  /** In-app "callback coming up" reminder lead time. */
  callbackLeadMinutes: number;
  /** A callback this many minutes past its time is "overdue" (alert turns persistent). */
  callbackGraceMinutes: number;
  /** Company contact rules (applied on top of per-client restrictions). */
  companyRules: {
    maxCallAttemptsPerDay: number;
    allowTexts: boolean;
    allowVoicemails: boolean;
  };
  pageSize: number;
}

export const DEFAULT_CONFIG: FollowUpConfig = {
  cadence: DEFAULT_CADENCE,
  workdays: [1, 2, 3, 4, 5],
  holidays: [],
  callingStart: "09:00",
  callingEnd: "20:00",
  defaultTimezone: "America/New_York",
  callbackLeadMinutes: 15,
  callbackGraceMinutes: 5,
  companyRules: { maxCallAttemptsPerDay: 1, allowTexts: true, allowVoicemails: true },
  pageSize: 50,
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Merges stored JSON over defaults and drops anything invalid, so a bad save can't break the queue. */
export function parseConfig(raw: string | null | undefined): FollowUpConfig {
  let parsed: Partial<FollowUpConfig> = {};
  try {
    parsed = raw ? (JSON.parse(raw) as Partial<FollowUpConfig>) : {};
  } catch {
    parsed = {};
  }
  const cfg: FollowUpConfig = {
    ...DEFAULT_CONFIG,
    ...parsed,
    companyRules: { ...DEFAULT_CONFIG.companyRules, ...(parsed.companyRules ?? {}) },
  };
  if (!cfg.cadence || !Array.isArray(cfg.cadence.steps) || validateCadence(cfg.cadence).length) {
    cfg.cadence = DEFAULT_CADENCE;
  }
  cfg.workdays = (Array.isArray(cfg.workdays) ? cfg.workdays : DEFAULT_CONFIG.workdays).filter(
    (d) => Number.isInteger(d) && d >= 0 && d <= 6
  );
  if (!cfg.workdays.length) cfg.workdays = DEFAULT_CONFIG.workdays;
  cfg.holidays = (Array.isArray(cfg.holidays) ? cfg.holidays : []).filter(isDateStr);
  if (!TIME_RE.test(cfg.callingStart)) cfg.callingStart = DEFAULT_CONFIG.callingStart;
  if (!TIME_RE.test(cfg.callingEnd)) cfg.callingEnd = DEFAULT_CONFIG.callingEnd;
  if (cfg.callingEnd <= cfg.callingStart) {
    cfg.callingStart = DEFAULT_CONFIG.callingStart;
    cfg.callingEnd = DEFAULT_CONFIG.callingEnd;
  }
  if (!(cfg.callbackLeadMinutes >= 0)) cfg.callbackLeadMinutes = DEFAULT_CONFIG.callbackLeadMinutes;
  if (!(cfg.callbackGraceMinutes >= 0)) cfg.callbackGraceMinutes = DEFAULT_CONFIG.callbackGraceMinutes;
  if (!(cfg.pageSize >= 10 && cfg.pageSize <= 500)) cfg.pageSize = DEFAULT_CONFIG.pageSize;
  return cfg;
}

// ── Client contact restrictions ───────────────────────────────────────────

export interface Restrictions {
  noCalls?: boolean;
  noTexts?: boolean;
  noEmail?: boolean;
  noPromoEmail?: boolean;
  /** Client explicitly asked to stop being contacted (distinct from declining an offer). */
  doNotContact?: boolean;
}

export function parseRestrictions(raw: string | null | undefined): Restrictions {
  try {
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" ? (v as Restrictions) : {};
  } catch {
    return {};
  }
}

/** Per-client + company rules → what channels a cadence step may use. */
export function permissionsFor(r: Restrictions, ghost: boolean, cfg: FollowUpConfig): ChannelPermissions {
  const blocked = ghost || !!r.doNotContact;
  return {
    call: !blocked && !r.noCalls,
    text: !blocked && !r.noTexts && cfg.companyRules.allowTexts,
    email: !blocked && !r.noEmail,
    voicemail: !blocked && !r.noCalls && cfg.companyRules.allowVoicemails,
  };
}
