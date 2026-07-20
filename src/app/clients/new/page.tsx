import Link from "next/link";
import { createClientAction } from "@/app/actions";
import { CLIENT_STATUSES, STATUS_LABELS } from "@/lib/types";
import { localDateString, nowET } from "@/lib/business-logic";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none";

export default function NewClientPage() {
  const today = localDateString(nowET());

  return (
    <div className="max-w-xl">
      <Link href="/follow-up" className="text-sm text-muted-foreground hover:text-gold">
        ← Back to 50% Follow-Up
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold text-foreground">Add New Client</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        First sale date starts the 15-day, 50%-commission countdown. Defaults to today, but you
        can backdate it when importing from the old Master List.
      </p>

      <form action={createClientAction} className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm text-muted-foreground" htmlFor="name">
            Client Name
          </label>
          <input id="name" name="name" type="text" required className={inputClass} />
        </div>

        <div>
          <label className="mb-1 block text-sm text-muted-foreground" htmlFor="phone">
            Phone Number
          </label>
          <input id="phone" name="phone" type="tel" required className={inputClass} />
        </div>

        <div>
          <label className="mb-1 block text-sm text-muted-foreground" htmlFor="opener">
            Opener
          </label>
          <input
            id="opener"
            name="opener"
            type="text"
            placeholder="e.g. Arnold"
            className={inputClass}
          />
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="firstSaleDate">
              First Sale Date
            </label>
            <input
              id="firstSaleDate"
              name="firstSaleDate"
              type="date"
              required
              defaultValue={today}
              className={inputClass}
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="firstSaleAmount">
              First Sale Amount
            </label>
            <input
              id="firstSaleAmount"
              name="firstSaleAmount"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm text-muted-foreground" htmlFor="status">
            Status
          </label>
          <select id="status" name="status" defaultValue="NO_DISPO" className={inputClass}>
            {CLIENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm text-muted-foreground" htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            placeholder="Interests mentioned, coin types discussed, etc."
            className={inputClass}
          />
        </div>

        <button
          type="submit"
          className="rounded bg-gold px-4 py-2 text-sm font-medium text-brand-black transition-opacity hover:opacity-90"
        >
          Add Client
        </button>
      </form>
    </div>
  );
}
