import Link from "next/link";
import DailyQueue from "@/components/DailyQueue";
import { getDailyQueue } from "@/lib/followup/queue";
import { reconcile } from "@/lib/followup/reconcile";
import { fmtDate } from "@/lib/followup/present";

export const dynamic = "force-dynamic";

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ qp?: string }> }) {
  const { qp } = await searchParams;
  const now = new Date();
  await reconcile(now);
  const queue = await getDailyQueue(now, { page: Number(qp) || 1 });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Daily Queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">Today (Eastern): {fmtDate(queue.today)}</p>
        </div>
        <Link href="/queue/exceptions" className="rounded border border-gold px-3 py-1.5 text-sm font-medium text-gold hover:bg-gold/10">
          Exceptions →
        </Link>
      </div>
      <DailyQueue queue={queue} basePath="/queue" />
    </div>
  );
}
