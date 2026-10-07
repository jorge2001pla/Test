"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { dismissNoteReminderAction, setReminderDoneAction } from "@/app/actions";

interface Alert {
  id: string;
  kind: "CALLBACK" | "REMINDER" | "NOTE" | "QUEUE";
  title: string;
  detail: string;
  href: string;
  dueAt: string | null;
  level: "UPCOMING" | "DUE" | "OVERDUE";
  recordId?: string;
}

const POLL_MS = 30_000;
const STORE_KEY = "prc-notified";
const KIND_LABEL: Record<Alert["kind"], string> = { CALLBACK: "Callback", REMINDER: "Reminder", NOTE: "Note", QUEUE: "Follow-ups" };

function when(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", timeZoneName: "short", month: "short", day: "numeric" }).format(new Date(iso));
}
function minutesFromNow(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
}
function readFired(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}"); } catch { return {}; }
}
function writeFired(v: Record<string, string>) {
  try {
    const keys = Object.keys(v);
    if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete v[k];
    localStorage.setItem(STORE_KEY, JSON.stringify(v));
  } catch { /* storage unavailable — alerts still show in the banner */ }
}

function levelText(a: Alert): string {
  if (a.level === "UPCOMING") return a.dueAt ? `in ${minutesFromNow(a.dueAt)} min` : "soon";
  if (a.level === "DUE") return a.kind === "QUEUE" ? "today" : "DUE NOW";
  return a.dueAt ? `overdue ${Math.abs(minutesFromNow(a.dueAt))} min` : "overdue";
}

/**
 * In-app alerts for callbacks, reminders, note reminders and today's follow-ups. They appear ONLY
 * while this app is open in a browser tab (checked every 30 seconds) — nothing is pushed to a phone
 * or when the tab is closed. If you allow desktop notifications, the browser also pops a
 * notification when something comes due (it works from a background tab, but only while the app tab
 * stays open). The items live in the database, so anything missed stays here until you handle it.
 */
export default function CallbackAlerts() {
  const pathname = usePathname();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [, tick] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("unsupported");
  const baseTitle = useRef<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/followup/alerts", { cache: "no-store", headers: { accept: "application/json" } });
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return;
      const data = (await res.json()) as { alerts: Alert[] };
      setAlerts(data.alerts);

      const urgent = data.alerts.filter((a) => a.level !== "UPCOMING" && a.kind !== "QUEUE");
      if (baseTitle.current === null) baseTitle.current = document.title.replace(/^⏰ \(\d+\) /, "");
      document.title = urgent.length ? `⏰ (${urgent.length}) ${baseTitle.current}` : baseTitle.current;

      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        const fired = readFired();
        for (const a of data.alerts) {
          if (fired[a.id] === a.level) continue;
          fired[a.id] = a.level;
          try {
            const n = new Notification(`${KIND_LABEL[a.kind]}${a.level === "UPCOMING" ? " soon" : a.level === "OVERDUE" ? " overdue" : ""}: ${a.title}`, { body: a.detail, tag: a.id });
            n.onclick = () => { window.focus(); window.location.href = a.href; n.close(); };
          } catch { /* some browsers block constructing notifications — banner still works */ }
        }
        writeFired(fired);
      }
    } catch {
      /* offline or logged out — try again next tick */
    }
  }, []);

  useEffect(() => {
    if (pathname === "/login") return;
    const first = setTimeout(() => {
      setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
      poll();
    }, 0);
    const id = setInterval(() => { poll(); tick((n) => n + 1); }, POLL_MS);
    const onVis = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onVis);
    return () => { clearTimeout(first); clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [pathname, poll]);

  async function dismiss(a: Alert) {
    if (!a.recordId) return;
    setAlerts((cur) => cur.filter((x) => x.id !== a.id));
    if (a.kind === "REMINDER") await setReminderDoneAction(a.recordId, true);
    else if (a.kind === "NOTE") await dismissNoteReminderAction(a.recordId);
  }

  if (pathname === "/login") return null;
  const askPermission = perm === "default";
  if (alerts.length === 0 && !askPermission) return null;

  const urgent = alerts.filter((a) => a.level !== "UPCOMING").length;
  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card shadow-xl" role="status" aria-live="polite">
      <button type="button" onClick={() => setCollapsed((v) => !v)} className={`flex w-full items-center justify-between rounded-t-lg px-3 py-2 text-left text-sm font-semibold ${urgent ? "bg-red-600 text-white" : "bg-blue-600 text-white"}`}>
        <span>{alerts.length === 0 ? "Alerts" : urgent ? `${urgent} item${urgent === 1 ? "" : "s"} need you` : `${alerts.length} coming up`}</span>
        <span>{collapsed ? "▲" : "▼"}</span>
      </button>
      {!collapsed && (
        <ul className="max-h-80 divide-y divide-border overflow-y-auto">
          {alerts.map((a) => (
            <li key={a.id} className="px-3 py-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0">
                  <span className="mr-1.5 rounded bg-gold/15 px-1 py-0.5 text-[10px] font-semibold uppercase text-gold">{KIND_LABEL[a.kind]}</span>
                  <Link href={a.href} className="font-medium text-foreground hover:text-gold hover:underline">{a.title}</Link>
                </span>
                <span className={`shrink-0 text-xs font-semibold ${a.level === "OVERDUE" ? "text-red-600 dark:text-red-400" : a.level === "DUE" ? "text-orange-600 dark:text-orange-400" : "text-blue-600 dark:text-blue-400"}`}>{levelText(a)}</span>
              </div>
              <p className="text-xs text-muted-foreground">{a.detail}{a.dueAt ? ` · ${when(a.dueAt)}` : ""}</p>
              <div className="flex gap-3 text-xs">
                <Link href={a.href} className="text-gold hover:underline">Open →</Link>
                {a.recordId && <button type="button" onClick={() => dismiss(a)} className="text-muted-foreground hover:text-gold">{a.kind === "REMINDER" ? "Done" : "Dismiss"}</button>}
              </div>
            </li>
          ))}
          {askPermission && (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              <button type="button" onClick={async () => setPerm(await Notification.requestPermission())} className="font-medium text-gold hover:underline">
                Turn on desktop notifications
              </button>{" "}
              so these pop up even if this tab is in the background.
            </li>
          )}
          <li className="px-3 py-1.5 text-[11px] text-muted-foreground">Works only while this app is open in a browser tab — nothing is sent to your phone.</li>
        </ul>
      )}
    </div>
  );
}
