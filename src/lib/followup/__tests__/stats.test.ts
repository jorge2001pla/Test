import { beforeAll, describe, expect, it } from "vitest";
import db, { ready } from "@/lib/db";
import { ensurePartyForBook } from "../store";
import { recordSale } from "../sales";
import { getSalesStats } from "../sales-stats";

const NOW = new Date("2026-10-14T15:00:00Z"); // Wed Oct 14

beforeAll(async () => {
  await ready();
});

describe("sales tracker", () => {
  it("counts every qualifying sale (no profit needed), skips opener-only, and paces to the monthly goal", async () => {
    await db.execute("INSERT INTO book_clients (id, first_name, phone, source) VALUES ('st1','Stat','305-555-0001','manual')");
    const partyId = (await ensurePartyForBook("st1"))!;
    const k = (n: number) => `stat-${n}`;
    await recordSale({ partyId, saleDate: "2026-10-14", amount: 100, idemKey: k(1), now: NOW });
    await recordSale({ partyId, saleDate: "2026-10-14", amount: 200, idemKey: k(2), now: NOW }); // second sale, same client, same day
    await recordSale({ partyId, saleDate: "2026-10-12", amount: 300, idemKey: k(3), now: NOW });
    await recordSale({ partyId, saleDate: "2026-10-14", amount: 19.95, kind: "OPENER_ONLY", idemKey: k(4), now: NOW });
    await recordSale({ partyId, saleDate: "2026-09-30", amount: 50, idemKey: k(5), now: new Date("2026-09-30T15:00:00Z") }); // last month
    const s = await getSalesStats(NOW);
    expect(s.todayCount).toBe(2);
    expect(s.monthCount).toBe(3);
    expect(s.dailyGoal).toBe(5);
    expect(s.monthlyGoal).toBe(100);
    expect(s.workdaysLeft).toBe(13); // Oct 14–30 weekdays
    expect(s.neededPerDay).toBe(Math.ceil(97 / 13));
    expect(s.trend).toHaveLength(14);
    expect(s.trend[s.trend.length - 1].count).toBe(2);
  });
});
