import Link from "next/link";
import { createBookClientAction } from "@/app/actions";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none";

export default async function NewBookClientPage({
  searchParams,
}: {
  searchParams: Promise<{ existing?: string }>;
}) {
  const { existing } = await searchParams;
  const isExisting = existing === "1";

  return (
    <div className="max-w-xl">
      <Link href="/book" className="text-sm text-muted-foreground hover:text-gold">
        ← Back to Clients
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold text-foreground">
        {isExisting ? "Add Client" : "Log New Account"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {isExisting
          ? "For an existing or reactivated client who should go straight into your book — no 15-day window to track."
          : "For accounts you opened yourself (e.g. the Morgan promo) that go straight into your book — no 15-day window to track."}{" "}
        Either way, they count toward this week&apos;s goal.
      </p>

      <form action={createBookClientAction} className="mt-6 space-y-4">
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="firstName">
              First Name
            </label>
            <input id="firstName" name="firstName" type="text" className={inputClass} />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="lastName">
              Last Name
            </label>
            <input id="lastName" name="lastName" type="text" className={inputClass} />
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="phone">
              Phone Number
            </label>
            <input id="phone" name="phone" type="tel" className={inputClass} />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="secondaryPhone">
              Secondary Number
            </label>
            <input id="secondaryPhone" name="secondaryPhone" type="tel" className={inputClass} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm text-muted-foreground" htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" className={inputClass} />
        </div>

        <div>
          <label className="mb-1 block text-sm text-muted-foreground" htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            placeholder="How the account was opened, coin types discussed, etc."
            className={inputClass}
          />
        </div>

        <button
          type="submit"
          className="rounded bg-gold px-4 py-2 text-sm font-medium text-brand-black transition-opacity hover:opacity-90"
        >
          Add to Book
        </button>
      </form>
    </div>
  );
}
