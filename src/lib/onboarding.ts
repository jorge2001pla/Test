import db, { ready } from "./db";
import { ONBOARDING_EMAILS, type OnboardingEmailKey } from "./types";

/**
 * Onboarding-email auto-marking (Jorge, Sept 3 2026).
 *
 * Klaviyo sends the four onboarding emails on its own flow the moment a client with an email
 * enters the system. The Command Center mirrors that timing and ticks the checkboxes itself so
 * nobody has to remember — the manual toggles keep working on top of it.
 *
 *   Welcome + Morgan Silver   ~1 hour after entry
 *   Double Eagle              24 hours
 *   Top Coins In-House        48 hours
 *
 * "Entry" = the first moment the client has an email on file (`onboarding_started_at`).
 * Clients that existed before this shipped are never back-filled; they start only if an email
 * is added to them later. Enabled per deployment with ONBOARDING_AUTOMARK=1 so a copy of the app
 * without the Klaviyo flow doesn't tick boxes for emails that never went out.
 */
export const ONBOARDING_SCHEDULE: Record<OnboardingEmailKey, { afterMs: number; label: string }> = {
  WELCOME: { afterMs: 60 * 60_000, label: "1 hour after entry" },
  MORGAN: { afterMs: 60 * 60_000, label: "1 hour after entry" },
  DOUBLE_EAGLE: { afterMs: 24 * 60 * 60_000, label: "24 hours after entry" },
  TOP_COINS: { afterMs: 48 * 60 * 60_000, label: "48 hours after entry" },
};

export type OnboardingMark = { at: string; by: "auto" | "manual" };
export type OnboardingMarks = Partial<Record<OnboardingEmailKey, OnboardingMark>>;

export function automarkEnabled(): boolean {
  return process.env.ONBOARDING_AUTOMARK === "1";
}

export function parseMarks(raw: string | null | undefined): OnboardingMarks {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as OnboardingMarks;
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

/** When each email is due for a client whose sequence started at `startedAt` (ISO). */
export function dueTimes(startedAt: string): Record<OnboardingEmailKey, Date> {
  const t0 = new Date(startedAt).getTime();
  const out = {} as Record<OnboardingEmailKey, Date>;
  for (const e of ONBOARDING_EMAILS) out[e.key] = new Date(t0 + ONBOARDING_SCHEDULE[e.key].afterMs);
  return out;
}

let lastSweep = 0;

/**
 * Tick every checkbox whose Klaviyo send time has passed. Cheap enough to run on every page
 * load; throttled to once a minute per server instance. Each key is auto-applied at most once
 * (`onboarding_auto`), so a box Jorge unticks by hand stays unticked.
 */
export async function sweepOnboarding(force = false): Promise<number> {
  if (!automarkEnabled()) return 0;
  if (!force && Date.now() - lastSweep < 60_000) return 0;
  lastSweep = Date.now();
  await ready();
  const res = await db.execute(
    `SELECT id, onboarding_started_at, onboarding_emails, onboarding_auto, onboarding_marks
       FROM clients
      WHERE onboarding_started_at IS NOT NULL
        AND email IS NOT NULL AND email != ''
        AND onboarding_started_at >= datetime('now', '-4 days')`
  );
  const now = Date.now();
  let changed = 0;
  for (const r of res.rows as unknown as {
    id: string;
    onboarding_started_at: string;
    onboarding_emails: string | null;
    onboarding_auto: string | null;
    onboarding_marks: string | null;
  }[]) {
    const due = dueTimes(r.onboarding_started_at);
    const have = new Set((r.onboarding_emails ?? "").split(",").filter(Boolean));
    const auto = new Set((r.onboarding_auto ?? "").split(",").filter(Boolean));
    const marks = parseMarks(r.onboarding_marks);
    let touched = false;
    for (const e of ONBOARDING_EMAILS) {
      if (auto.has(e.key) || due[e.key].getTime() > now) continue;
      auto.add(e.key);
      if (!have.has(e.key)) {
        have.add(e.key);
        marks[e.key] = { at: due[e.key].toISOString(), by: "auto" };
      }
      touched = true;
    }
    if (!touched) continue;
    changed++;
    await db.execute({
      sql: `UPDATE clients SET onboarding_emails = ?, onboarding_auto = ?, onboarding_marks = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [
        ONBOARDING_EMAILS.map((e) => e.key).filter((k) => have.has(k)).join(",") || null,
        ONBOARDING_EMAILS.map((e) => e.key).filter((k) => auto.has(k)).join(","),
        JSON.stringify(marks),
        r.id,
      ],
    });
  }
  return changed;
}
