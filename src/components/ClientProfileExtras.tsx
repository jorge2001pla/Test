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

/** V1 qualification / product interest / onboarding email tracker on the client
 * profile. Every control saves immediately — no separate save button to forget. */
export default function ClientProfileExtras({
  clientId,
  initialQualification,
  initialInterests,
  initialEmails,
}: {
  clientId: string;
  initialQualification: Qualification;
  initialInterests: ProductInterestKey[];
  initialEmails: OnboardingEmailKey[];
}) {
  const [qualification, setQualification] = useState<Qualification>(initialQualification);
  const [interests, setInterests] = useState<ProductInterestKey[]>(initialInterests);
  const [emails, setEmails] = useState<OnboardingEmailKey[]>(initialEmails);
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
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    latest.current = { ...latest.current, emails: next };
    setEmails(next);
    save();
  }

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
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Onboarding Emails
        </p>
        <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {ONBOARDING_EMAILS.map((item) => (
            <label
              key={item.key}
              className="flex cursor-pointer items-center gap-2.5 rounded border border-transparent px-1 py-1 text-sm text-foreground hover:border-border"
            >
              <input
                type="checkbox"
                checked={emails.includes(item.key)}
                onChange={() => toggleEmail(item.key)}
                className="h-4 w-4 accent-[#c99622]"
              />
              {item.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
