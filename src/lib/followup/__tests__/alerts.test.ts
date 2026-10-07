import { beforeAll, describe, expect, it } from "vitest";
import db, { ready } from "@/lib/db";
import { getAlerts } from "../alerts";
import { createReminder } from "@/lib/reminders";
import { createNote, dismissNoteReminder } from "@/lib/notes";

// Wed 2026-10-07 11:00 ET
const NOW = new Date("2026-10-07T15:00:00Z");

beforeAll(async () => {
  await ready();
});

describe("alerts feed", () => {
  it("timed reminders alert upcoming, due and overdue; far-future ones do not", async () => {
    await createReminder("call the show organizer", "2026-10-07", null, "11:10"); // 10 min away
    await createReminder("late one", "2026-10-07", null, "10:00"); // an hour ago
    await createReminder("tomorrow", "2026-10-08", null, "09:00");
    const a = await getAlerts(NOW);
    const by = (t: string) => a.find((x) => x.title === t);
    expect(by("call the show organizer")?.level).toBe("UPCOMING");
    expect(by("late one")?.level).toBe("OVERDUE");
    expect(by("tomorrow")).toBeUndefined();
  });

  it("date-only reminders are due today / overdue after", async () => {
    await createReminder("dated today", "2026-10-07");
    await createReminder("dated yesterday", "2026-10-06");
    const a = await getAlerts(NOW);
    expect(a.find((x) => x.title === "dated today")?.level).toBe("DUE");
    expect(a.find((x) => x.title === "dated yesterday")?.level).toBe("OVERDUE");
  });

  it("a note with a reminder alerts until dismissed; a plain note never does", async () => {
    await createNote("plain note");
    await createNote("remember to email Klaviyo list", "2026-10-07", "10:30");
    let a = await getAlerts(NOW);
    expect(a.find((x) => x.title.startsWith("plain"))).toBeUndefined();
    const n = a.find((x) => x.kind === "NOTE");
    expect(n?.level).toBe("OVERDUE");
    await dismissNoteReminder(n!.recordId!);
    a = await getAlerts(NOW);
    expect(a.find((x) => x.kind === "NOTE")).toBeUndefined();
  });
});
