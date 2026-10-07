import { describe, expect, it } from "vitest";
import {
  addDays, diffDays, zonedToUtc, dateInZone, etDate, isWithinCallingHours, nextAllowedSlot,
  inferTimezoneFromPhone, type CallingRules,
} from "../dates";
import {
  commissionStatus, classifySale, commissionWindowEnd, cycleEnd, cycleDay, cycleHasEnded,
  lastWorkdayBeforeWindowEnd,
} from "../commission";
import { DEFAULT_CADENCE, planCadence, splitDueAndMissed, summarizeCadence, ALL_CHANNELS_ALLOWED } from "../cadence";

const rules: CallingRules = {
  workdays: [1, 2, 3, 4, 5], holidays: [], callingStart: "09:00", callingEnd: "20:00",
};

describe("commission window (inclusive day 15)", () => {
  it("opening date is day 1 and day 15 = opening + 14", () => {
    expect(commissionWindowEnd("2026-10-01")).toBe("2026-10-15");
    expect(commissionStatus("2026-10-01", "2026-10-01").day).toBe(1);
    expect(commissionStatus("2026-10-01", "2026-10-15").eligibility).toBe("IN_WINDOW");
    expect(commissionStatus("2026-10-01", "2026-10-15").daysRemaining).toBe(1);
    expect(commissionStatus("2026-10-01", "2026-10-16").eligibility).toBe("EXPIRED");
  });
  it("unknown opening date is unknown, never guessed", () => {
    expect(commissionStatus(null, "2026-10-01").eligibility).toBe("UNKNOWN");
    expect(classifySale("2026-10-01", null).kind).toBe("UNKNOWN");
  });
  it("tiers: first call 70, in window 50, after 17.5", () => {
    expect(classifySale("2026-10-01", "2026-10-01", true).rate).toBe(0.7);
    expect(classifySale("2026-10-15", "2026-10-01").rate).toBe(0.5);
    expect(classifySale("2026-10-16", "2026-10-01").rate).toBe(0.175);
  });
  it("a repeat sale does not move the window end", () => {
    const before = commissionWindowEnd("2026-10-01");
    cycleEnd("2026-10-10"); // a later sale starts a cycle only
    expect(commissionWindowEnd("2026-10-01")).toBe(before);
  });
  it("flags the earlier workday when the window ends on a weekend", () => {
    // 2026-10-01 + 14 = 2026-10-15 (Thu). Use opening 2026-10-04 → end 2026-10-18 (Sun)
    expect(lastWorkdayBeforeWindowEnd("2026-10-04", rules)).toBe("2026-10-16");
    expect(lastWorkdayBeforeWindowEnd("2026-10-01", rules)).toBeNull();
  });
});

describe("30-day cycle (inclusive day 30)", () => {
  it("sale date is day 1, day 30 = sale + 29", () => {
    expect(cycleEnd("2026-10-01")).toBe("2026-10-30");
    expect(cycleDay("2026-10-01", "2026-10-30")).toBe(30);
    expect(cycleHasEnded("2026-10-01", "2026-10-30")).toBe(false);
    expect(cycleHasEnded("2026-10-01", "2026-10-31")).toBe(true);
  });
});

describe("cadence", () => {
  it("default is 10 calls, ≤4 voicemails, ≤3 texts", () => {
    expect(summarizeCadence(DEFAULT_CADENCE)).toEqual({ calls: 10, voicemails: 4, texts: 3 });
  });
  it("moves weekend steps to a workday, never past cycle end, one step per date", () => {
    const plan = planCadence("2026-10-05", rules); // Monday
    const dates = plan.map((p) => p.dueDate);
    expect(new Set(dates).size).toBe(dates.length);
    for (const p of plan) {
      expect(p.dueDate <= cycleEnd("2026-10-05")).toBe(true);
      expect(rules.workdays).toContain(new Date(p.dueDate + "T00:00:00Z").getUTCDay());
    }
  });
  it("collisions merge into one call", () => {
    const plan = planCadence("2026-10-02", rules, {
      steps: [
        { day: 2, call: true, voicemail: false, text: false, purpose: "a" }, // Sat → Mon
        { day: 3, call: true, voicemail: true, text: false, purpose: "b" }, // Sun → Mon
      ],
    });
    expect(plan).toHaveLength(1);
    expect(plan[0].voicemail).toBe(true);
    expect(plan[0].mergedDays).toEqual([2]);
  });
  it("respects no-text permission", () => {
    const plan = planCadence("2026-10-06", rules, DEFAULT_CADENCE, { ...ALL_CHANNELS_ALLOWED, text: false });
    expect(plan.some((p) => p.text)).toBe(false);
    expect(plan).toHaveLength(10);
  });
  it("missed steps never burst: only the latest due step is actionable", () => {
    const plan = planCadence("2026-10-05", rules);
    const r = splitDueAndMissed(plan, "2026-10-20");
    expect(r.actionable).not.toBeNull();
    expect(r.missed.length).toBeGreaterThan(0);
    expect(r.actionable!.dueDate > r.missed[r.missed.length - 1].dueDate).toBe(true);
  });
});

describe("time zones & DST", () => {
  it("ET business date rolls at Eastern midnight, not UTC", () => {
    expect(etDate(new Date("2026-10-08T03:30:00Z"))).toBe("2026-10-07");
  });
  it("zonedToUtc handles both sides of DST", () => {
    expect(zonedToUtc("2026-03-07", "09:00", "America/New_York").toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(zonedToUtc("2026-03-09", "09:00", "America/New_York").toISOString()).toBe("2026-03-09T13:00:00.000Z");
    expect(zonedToUtc("2026-11-01", "09:00", "America/New_York").toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });
  it("calendar math is DST-proof", () => {
    expect(diffDays("2026-03-01", "2026-04-01")).toBe(31);
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  });
  it("calling hours use the client's local time", () => {
    // 2026-10-07 (Wed) 14:30Z = 10:30 ET = 07:30 PT
    const t = new Date("2026-10-07T14:30:00Z");
    expect(isWithinCallingHours(t, "America/New_York", rules)).toBe(true);
    expect(isWithinCallingHours(t, "America/Los_Angeles", rules)).toBe(false);
    const slot = nextAllowedSlot(t, "America/Los_Angeles", rules);
    expect(slot.toISOString()).toBe("2026-10-07T16:00:00.000Z");
  });
  it("skips weekends when finding the next slot", () => {
    const sat = new Date("2026-10-10T15:00:00Z");
    expect(dateInZone(nextAllowedSlot(sat, "America/New_York", rules))).toBe("2026-10-12");
  });
  it("infers zone from area code", () => {
    expect(inferTimezoneFromPhone("(305) 555-1212")).toBe("America/New_York");
    expect(inferTimezoneFromPhone("+1 310 555 1212")).toBe("America/Los_Angeles");
    expect(inferTimezoneFromPhone("12")).toBeNull();
  });
});
