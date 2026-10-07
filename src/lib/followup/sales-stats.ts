/** Sales tracker: every qualifying sale Jorge records counts (no commission or profit involved). */
import { addDays, diffDays, etDate, isWorkday, type DateStr } from "./dates";
import { getConfig, q } from "./store";

export interface SalesStats {
  today: DateStr;
  todayCount: number;
  dailyGoal: number;
  monthLabel: string;
  monthCount: number;
  monthlyGoal: number;
  /** Working days left in the month, counting today. */
  workdaysLeft: number;
  /** Sales per remaining workday needed to hit the monthly goal (0 when already met). */
  neededPerDay: number;
  /** Last N days, oldest first. */
  trend: { date: DateStr; count: number }[];
}

export async function getSalesStats(now: Date = new Date(), trendDays = 14): Promise<SalesStats> {
  const cfg = await getConfig();
  const today = etDate(now);
  const monthStart = `${today.slice(0, 8)}01`;
  const [y, m] = today.split("-").map(Number);
  const monthEnd = addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
  const from = addDays(today, -(trendDays - 1));
  const lo = from < monthStart ? from : monthStart;

  const rows = await q<{ sale_date: string; n: number }>(
    "SELECT sale_date, COUNT(*) AS n FROM fu_orders WHERE qualifying = 1 AND sale_date >= ? AND sale_date <= ? GROUP BY sale_date",
    [lo, today]
  );
  const by = new Map(rows.map((r) => [r.sale_date, Number(r.n)]));
  let monthCount = 0;
  for (const [d, n] of by) if (d >= monthStart) monthCount += n;

  let workdaysLeft = 0;
  for (let d = today; d <= monthEnd; d = addDays(d, 1)) if (isWorkday(d, cfg)) workdaysLeft++;
  const remaining = Math.max(0, cfg.monthlySalesGoal - monthCount);

  return {
    today,
    todayCount: by.get(today) ?? 0,
    dailyGoal: cfg.dailySalesGoal,
    monthLabel: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${monthStart}T00:00:00Z`)),
    monthCount,
    monthlyGoal: cfg.monthlySalesGoal,
    workdaysLeft,
    neededPerDay: remaining === 0 ? 0 : workdaysLeft === 0 ? remaining : Math.ceil(remaining / workdaysLeft),
    trend: Array.from({ length: trendDays }, (_, i) => {
      const date = addDays(from, i);
      return { date, count: by.get(date) ?? 0 };
    }),
  };
}

export { diffDays };
