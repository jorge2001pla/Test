"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Alert {
  taskId: string;
  partyId: string;
  name: string;
  phone: string | null;
  href: string;
  dueAt: string;
  level: "UPCOMING" | "DUE" | "OVERDUE";
  purpose: string;
}

const POLL_MS = 30_000;

function when(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", timeZoneName: "short", month: "short", day: "numeric" }).format(new Date(iso));
}

function minutesFromNow(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
}

/**
 * In-app callback reminders. These appear ONLY while this app is open in a browser tab (checked
 * every 30 seconds) — they are not phone notifications and nothing is pushed when the tab is closed.
 * Alerts are saved server-side (the callback task), so a missed one persists as OVERDUE until you
 * complete, reschedule or cancel it.
 */
export default function CallbackAlerts() {
  const pathname = usePathname();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [, tick] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const lastDue = useRef<Set<string>>(new Set());

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/followup/alerts", { cache: "no-store", headers: { accept: "application/json" } });
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return;
      const data = (await res.json()) as { alerts: Alert[] };
      setAlerts(data.alerts);
      // Make the due-now moment hard to miss: update the tab title once per newly-due callback.
      const nowDue = data.alerts.filter((a) => a.level !== "UPCOMING").map((a) => a.taskId);
      if (nowDue.some((id) => !lastDue.current.has(id))) {
        document.title = `⏰ Callback due — ${data.alerts.find((a) => a.level !== "UPCOMING")?.name ?? ""}`;
      } else if (nowDue.length === 0) {
        document.title = document.title.replace(/^⏰ Callback due — .*$/, "Premier Rare Coins — New Client Tracker");
      }
      lastDue.current = new Set(nowDue);
    } catch {
      /* offline or logged out — try again next tick */
    }
  }, []);

  useEffect(() => {
    if (pathname === "/login") return;
    const first = setTimeout(poll, 0);
    const id = setInterval(() => { poll(); tick((n) => n + 1); }, POLL_MS);
    const onVis = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onVis);
    return () => { clearTimeout(first); clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [pathname, poll]);

  if (pathname === "/login" || alerts.length === 0) return null;

  const urgent = alerts.filter((a) => a.level !== "UPCOMING").length;
  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card shadow-xl" role="status" aria-live="polite">
      <button type="button" onClick={() => setCollapsed((v) => !v)} className={`flex w-full items-center justify-between rounded-t-lg px-3 py-2 text-left text-sm font-semibold ${urgent ? "bg-red-600 text-white" : "bg-blue-600 text-white"}`}>
        <span>{urgent ? `${urgent} callback${urgent === 1 ? "" : "s"} due / overdue` : `${alerts.length} callback${alerts.length === 1 ? "" : "s"} coming up`}</span>
        <span>{collapsed ? "▲" : "▼"}</span>
      </button>
      {!collapsed && (
        <ul className="max-h-72 divide-y divide-border overflow-y-auto">
          {alerts.map((a) => {
            const m = minutesFromNow(a.dueAt);
            return (
              <li key={a.taskId} className="px-3 py-2 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={a.href} className="font-medium text-foreground hover:text-gold hover:underline">{a.name}</Link>
                  <span className={`text-xs font-semibold ${a.level === "OVERDUE" ? "text-red-600 dark:text-red-400" : a.level === "DUE" ? "text-orange-600 dark:text-orange-400" : "text-blue-600 dark:text-blue-400"}`}>
                    {a.level === "UPCOMING" ? `in ${m} min` : a.level === "DUE" ? "DUE NOW" : `overdue ${Math.abs(m)} min`}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{a.phone ?? ""} · {when(a.dueAt)}</p>
                <Link href="/queue" className="text-xs text-gold hover:underline">Open queue to log / reschedule →</Link>
              </li>
            );
          })}
          <li className="px-3 py-1.5 text-[11px] text-muted-foreground">In-app reminder — shows while this app is open in a browser tab; no phone notification.</li>
        </ul>
      )}
    </div>
  );
}
