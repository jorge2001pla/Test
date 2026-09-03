"use client";

import { useRef, useState, useTransition } from "react";
import {
  ONBOARDING_EMAILS,
  PRODUCT_INTERESTS,
  type OnboardingEmailKey,
  type ProductInterestKey,
  type Qualification,
} from "@/lib/types";
import { updateClientProfileExtrasAction } from "@/app/actions";

type Mark = { at: string; by: "auto" | "manual" };

/** Klaviyo's onboarding flow timing, mirrored here so the boxes tick themselves. */
const AFTER_MS: Record<OnboardingEmailKey, number> = {
  WELCOME: 60 * 60_000,
  MORGAN: 60 * 60_000,
  DOUBLE_EAGLE: 24 * 60 * 60_000,
  TOP_COINS: 48 * 60 * 60_000,
};

function fmt(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function untilLabel(due: Date, now: Date) {
  const ms = due.getTime() - now.getTime();
  if (ms <= 0) return "due now";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 36) return `in ${h} h`;
  return `in ${Math.round(h / 24)} days`;
}

/** V1 qualification / product interest / onboarding email tracker on the client
 * profile. Every control saves immediately — no separate save button to forget.
 * Onboarding boxes also tick themselves on Klaviyo's schedule (see lib/onboarding.ts);
 * hand toggles still win. */
export default function ClientProfileExtras({
  clientId,
  initialQualification,
  initialInterests,
  initialEmails,
  hasEmail = true,
  startedAt = null,
  initialMarks = {},
}: {
  clientId: string;
  initialQualification: Qualification;
  initialInterests: ProductInterestKey[];
  initialEmails: OnboardingEmailKey[];
  hasEmail?: boolean;
  startedAt?: string | null;
  initialMarks?: Partial<Record<OnboardingEmailKey, Mark>>;
}) {
  const [qualification, setQualification] = useState<Qualification>(initialQualification);
  const [interests, setInterests] = useState<ProductInterestKey[]>(initialInterests);
  const [emails, setEmails] = useState<OnboardingEmailKey[]>(initialEmails);
  const [marks, setMarks] = useState<Partial<Record<OnboardingEmailKey, Mark>>>(initialMarks);
  const [pending, startTransition] = useTransition();

  // React batches state during rapid clicks, so reading state inside handlers can be
  // stale — this ref always holds the latest values, making every save complete.
  const latest = useRef({
    qualification: initialQualification,
    interests: initialInterests,
    emails: initialEmails,
  });

  function save() {
    const snapshot = { ...latest.current };
    startTransition(() =>
      updateClientProfileExtrasAction(clientId, {
        qualification: snapshot.qualification,
        productInterests: snapshot.interests,
        onboardingEmails: snapshot.emails,
      })
    );
  }

  function setQ(q: Qualification) {
    latest.current = { ...latest.current, qualification: q };
    setQualification(q);
    save();
  }

  function toggleInterest(key: ProductInterestKey) {
    const cur = latest.current.interests;
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    latest.current = { ...latest.current, interests: next };
    setInterests(next);
    save();
  }

  function toggleEmail(key: OnboardingEmailKey) {
    const cur = latest.current.emails;
    const on = !cur.includes(key);
    const next = on ? [...cur, key] : cur.filter((k) => k !== key);
    latest.current = { ...latest.current, emails: next };
    setEmails(next);
    setMarks((m) => {
      const copy = { ...m };
      if (on) copy[key] = { at: new Date().toISOString(), by: "manual" };
      else delete copy[key];
      return copy;
    });
    save();
  }

  const now = new Date();
  const started = startedAt ? new Date(startedAt) : null;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">
          Client Qualification
        </h2>
        {pending && <span className="text-xs text-muted-foreground">Saving…</span>}
      </div>

      <div className="mt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Qualification
        </p>
        <div className="mt-1.5 flex gap-2">
          {(["UNKNOWN", "QUALIFIED"] as const).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQ(q)}
              aria-pressed={qualification === q}
              className={`rounded px-3.5 py-1.5 text-sm font-medium transition-colors ${
                qualification === q
                  ? q === "QUALIFIED"
                    ? "bg-gold text-brand-black"
                    : "bg-foreground/10 text-foreground ring-1 ring-border"
                  : "border border-border text-muted-foreground hover:border-gold hover:text-gold"
              }`}
            >
              {q === "UNKNOWN" ? "Unknown" : "Qualified"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Product Interest
        </p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {PRODUCT_INTERESTS.map((item) => {
            const on = interests.includes(item.key);
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleInterest(item.key)}
                aria-pressed={on}
                className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                  on
                    ? "bg-gold/20 font-medium text-gold ring-1 ring-gold dark:text-gold-bright"
                    : "border border-border text-muted-foreground hover:border-gold hover:text-gold"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Onboarding Emails
          </p>
          <p className="text-xs text-muted-foreground">
            {!hasEmail
              ? "No email on file — Klaviyo flow won't start"
              : started
                ? `Klaviyo flow started ${fmt(started.toISOString())} · boxes tick on its schedule`
                : "Klaviyo flow starts when an email is added"}
          </p>
        </div>
        <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {ONBOARDING_EMAILS.map((item) => {
            const on = emails.includes(item.key);
            const mark = marks[item.key];
            const due = started ? new Date(started.getTime() + AFTER_MS[item.key]) : null;
            const hint = on
              ? mark
                ? `${mark.by === "auto" ? "auto" : "by hand"} · ${fmt(mark.at)}`
                : "sent"
              : due && hasEmail
                ? `${untilLabel(due, now)} · ${fmt(due.toISOString())}`
                : null;
            return (
              <label
                key={item.key}
                className="flex cursor-pointer items-start gap-2.5 rounded border border-transparent px-1 py-1 text-sm text-foreground hover:border-border"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleEmail(item.key)}
                  className="mt-0.5 h-4 w-4 accent-[#c99622]"
                />
                <span className="flex flex-col">
                  <span>{item.label}</span>
                  {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
