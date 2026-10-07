/** Small formatting helpers shared by the follow-up screens (server-safe, no DB). */
import { ET, formatBusinessDate, formatLocalDateTime, type DateStr } from "./dates";
import type { CommissionStatus } from "./commission";

export const fmtInstant = (iso: string | null | undefined, tz: string = ET): string =>
  iso ? formatLocalDateTime(new Date(iso), tz) : "—";

export const fmtDay = (iso: string | null | undefined): string =>
  iso
    ? new Intl.DateTimeFormat("en-US", { timeZone: ET, month: "short", day: "numeric" }).format(new Date(iso))
    : "never";

export const fmtDate = (d: DateStr | null | undefined): string => (d ? formatBusinessDate(d) : "—");

export function commissionLine(c: CommissionStatus): { text: string; tone: "ok" | "warn" | "muted" | "bad" } {
  switch (c.eligibility) {
    case "UNKNOWN":
      return { text: "Commission window: unknown — set the opening date", tone: "muted" };
    case "NOT_STARTED":
      return { text: `Window starts ${fmtDate(c.openingDate)}`, tone: "muted" };
    case "EXPIRED":
      return { text: `50% window ended ${fmtDate(c.windowEnd)} — 17.5% tier`, tone: "bad" };
    default:
      return {
        text: `50% window day ${c.day}/15 · ${c.daysRemaining === 1 ? "LAST DAY" : `${c.daysRemaining} days left`} (ends ${fmtDate(c.windowEnd)})`,
        tone: c.daysRemaining! <= 3 ? "warn" : "ok",
      };
  }
}
