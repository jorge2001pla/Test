/**
 * Pure date/time helpers for the 30-day follow-up system. No database, no process-timezone
 * dependence: every conversion goes through Intl, so results are identical on a UTC Vercel
 * server, a Windows dev box, or a test runner.
 *
 * Conventions (used by every follow-up table):
 *  - A "business date" is a plain YYYY-MM-DD string in America/New_York.
 *  - An "instant" is stored as a UTC ISO string (…Z) and rendered per-timezone on display.
 *  - Calendar-day arithmetic is done on UTC midnights of the date string, which is DST-proof.
 */

export const ET = "America/New_York";
export type DateStr = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateStr(value: unknown): value is DateStr {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function utcMidnight(date: DateStr): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date string: ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** date + n calendar days (n may be negative). */
export function addDays(date: DateStr, n: number): DateStr {
  return new Date(utcMidnight(date) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Whole calendar days from a to b (b − a). */
export function diffDays(a: DateStr, b: DateStr): number {
  return Math.round((utcMidnight(b) - utcMidnight(a)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: DateStr): number {
  return new Date(utcMidnight(date)).getUTCDay();
}

// ── Time zones ────────────────────────────────────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  s: number;
}

export function zonedParts(instant: Date, tz: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const part of formatterFor(tz).formatToParts(instant)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return { y: out.year, m: out.month, d: out.day, h: out.hour, min: out.minute, s: out.second };
}

/** The calendar date at `instant` in `tz` (default Eastern — the business clock). */
export function dateInZone(instant: Date, tz: string = ET): DateStr {
  const p = zonedParts(instant, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function etDate(instant: Date): DateStr {
  return dateInZone(instant, ET);
}

/** Minutes the zone is ahead of UTC at that instant (negative for the Americas). */
export function tzOffsetMinutes(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/**
 * Converts a wall-clock date+time in `tz` to the real UTC instant. DST-correct for any time that
 * exists on that day (calling hours are never in the 2–3 AM transition gap). A wall time that
 * does not exist (spring-forward gap) resolves to the instant just before the gap.
 */
export function zonedToUtc(date: DateStr, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const first = guess - tzOffsetMinutes(new Date(guess), tz) * 60_000;
  const second = guess - tzOffsetMinutes(new Date(first), tz) * 60_000;
  return new Date(second);
}

/** Legacy naive Eastern timestamp ("2026-10-07T14:30" / "…T14:30:00") → UTC instant. */
export function naiveEtToUtc(naive: string): Date {
  const [date, time = "00:00"] = naive.replace(" ", "T").split("T");
  return zonedToUtc(date, time.slice(0, 5), ET);
}

/** UTC instant → legacy naive Eastern string ("YYYY-MM-DDTHH:MM"). */
export function utcToNaiveEt(instant: Date): string {
  const p = zonedParts(instant, ET);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}`;
}

export function formatLocalTime(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
}

export function formatLocalDateTime(instant: Date, tz: string = ET): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
}

export function formatBusinessDate(date: DateStr): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

// ── Working days & calling hours ──────────────────────────────────────────

export interface WorkRules {
  /** 0 = Sunday … 6 = Saturday. */
  workdays: number[];
  holidays: DateStr[];
}

export interface CallingRules extends WorkRules {
  /** Client-local "HH:MM" window in which a call/text is allowed. */
  callingStart: string;
  callingEnd: string;
}

export function isWorkday(date: DateStr, rules: WorkRules): boolean {
  return rules.workdays.includes(dayOfWeek(date)) && !rules.holidays.includes(date);
}

export function nextWorkdayOnOrAfter(date: DateStr, rules: WorkRules): DateStr {
  let d = date;
  for (let i = 0; i < 400; i++) {
    if (isWorkday(d, rules)) return d;
    d = addDays(d, 1);
  }
  return date; // no workdays configured — never loop forever
}

export function prevWorkdayOnOrBefore(date: DateStr, rules: WorkRules): DateStr {
  let d = date;
  for (let i = 0; i < 400; i++) {
    if (isWorkday(d, rules)) return d;
    d = addDays(d, -1);
  }
  return date;
}

/** n workdays after `date` (n ≥ 1 skips the starting day). */
export function addWorkdays(date: DateStr, n: number, rules: WorkRules): DateStr {
  let d = date;
  let left = n;
  while (left > 0) {
    d = nextWorkdayOnOrAfter(addDays(d, 1), rules);
    left--;
  }
  return d;
}

/** Is `instant` a permitted moment to contact a client in `clientTz`? */
export function isWithinCallingHours(instant: Date, clientTz: string, rules: CallingRules): boolean {
  if (!isWorkday(etDate(instant), rules)) return false;
  const p = zonedParts(instant, clientTz);
  const minutes = p.h * 60 + p.min;
  const [sh, sm] = rules.callingStart.split(":").map(Number);
  const [eh, em] = rules.callingEnd.split(":").map(Number);
  return minutes >= sh * 60 + sm && minutes < eh * 60 + em;
}

/**
 * Earliest instant ≥ `from` that is inside the client's calling hours on one of the owner's
 * workdays. Returns `from` itself when it is already a permitted moment.
 */
export function nextAllowedSlot(from: Date, clientTz: string, rules: CallingRules): Date {
  const startDate = dateInZone(from, clientTz);
  for (let k = 0; k < 40; k++) {
    const date = addDays(startDate, k);
    const open = zonedToUtc(date, rules.callingStart, clientTz);
    const close = zonedToUtc(date, rules.callingEnd, clientTz);
    const candidate = new Date(Math.max(from.getTime(), open.getTime()));
    if (candidate.getTime() >= close.getTime()) continue;
    if (!isWorkday(etDate(candidate), rules)) continue;
    return candidate;
  }
  return new Date(from.getTime() + 86_400_000);
}

/** Earliest permitted instant on (or after the start of) the Eastern business date `date`. */
export function firstSlotOnWorkDate(date: DateStr, clientTz: string, rules: CallingRules): Date {
  return nextAllowedSlot(zonedToUtc(date, "00:00", ET), clientTz, rules);
}

/** Morning / midday / evening bucket of an instant in the client's local time. */
export type DayPeriod = "MORNING" | "AFTERNOON" | "EVENING";
export function dayPeriodOf(instant: Date, tz: string): DayPeriod {
  const h = zonedParts(instant, tz).h;
  if (h < 12) return "MORNING";
  if (h < 17) return "AFTERNOON";
  return "EVENING";
}

// ── Client time zone inference ────────────────────────────────────────────

const AREA_CODE_ZONES: Record<string, string> = {};
function zone(tz: string, codes: string) {
  for (const c of codes.split(/\s+/)) if (c) AREA_CODE_ZONES[c] = tz;
}
// Eastern
zone(
  "America/New_York",
  `203 475 860 959 302 202 239 305 321 352 386 407 561 656 689 727 754 772 786 813 863 904 941 954
   229 404 470 478 678 706 762 770 912 260 317 463 574 765 812 930 207 227 240 301 410 443 667
   339 351 413 508 617 774 781 857 978 231 248 269 313 517 586 616 734 810 947 989 906 603
   201 551 609 640 732 848 856 862 908 973 212 315 332 347 363 516 518 585 607 631 646 680 716 718
   838 845 914 917 929 934 252 336 704 743 828 910 919 980 984 216 220 234 330 380 419 440 513 567
   614 740 937 215 223 267 272 412 445 484 570 610 717 724 814 835 878 401 803 839 843 854 864 802
   276 434 540 571 703 757 804 686 948 304 681 502 606 859 423 865`
);
// Central
zone(
  "America/Chicago",
  `850 219 205 251 256 334 659 938 479 501 870 217 224 309 312 331 447 618 630 708 773 779 815 847 872
   319 515 563 641 712 316 620 785 913 225 318 337 504 985 218 320 507 612 651 763 952 228 601 662 769
   314 417 573 636 660 816 557 402 531 701 405 539 572 580 918 605 210 214 254 281 325 346 361 409 430
   432 469 512 682 713 726 737 817 830 832 903 936 940 956 972 979 262 274 414 534 608 715 920 270 364
   615 629 731 901 931`
);
// Mountain (DST observed)
zone("America/Denver", `303 719 720 970 983 208 986 406 505 575 385 435 801 307 915 308`);
// Arizona does not observe DST
zone("America/Phoenix", `480 520 602 623 928`);
// Pacific
zone(
  "America/Los_Angeles",
  `209 213 279 310 323 341 408 415 424 442 510 530 559 562 619 626 650 657 661 669 707 714 747 760 805
   818 820 831 858 909 916 925 949 951 702 725 775 458 503 541 971 206 253 360 425 509 564`
);
zone("America/Anchorage", "907");
zone("Pacific/Honolulu", "808");
zone("America/Puerto_Rico", "787 939");

/** Best-guess client zone from the phone's area code. It is a guess (cell numbers travel) — the
 * profile lets the owner override it, and the UI labels inferred zones as such. */
export function inferTimezoneFromPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const first = phone.split(";")[0];
  let digits = first.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  return AREA_CODE_ZONES[digits.slice(0, 3)] ?? null;
}

export function normalizePhoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.split(";")[0].replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length === 10 ? digits : null;
}

export function allPhoneDigits(...phones: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const p of phones) {
    if (!p) continue;
    for (const piece of p.split(";")) {
      const d = normalizePhoneDigits(piece);
      if (d) out.add(d);
    }
  }
  return [...out];
}

/** UTC instant → legacy naive Eastern string with seconds ("YYYY-MM-DDTHH:MM:SS"). */
export function utcToNaiveEtSec(instant: Date): string {
  const p = zonedParts(instant, ET);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}:${pad(p.s)}`;
}
