import { notFound } from "next/navigation";
import { getClient } from "@/lib/clients";
import { daysLeftInWindow, suggestsFallbackPitch } from "@/lib/business-logic";
import {
  formatCallbackTime,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDaysLeft,
} from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import AddToBookToggle from "@/components/AddToBookToggle";
import CallbackScheduleFields from "@/components/CallbackScheduleFields";
import PhoneLink from "@/components/PhoneLink";
import { addCallLogAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await getClient(id);
  if (!client) notFound();

  const daysLeft = daysLeftInWindow(client.firstSaleDate);
  const fallbackPitch =
    suggestsFallbackPitch(client.notes) ||
    client.callLogEntries.some((entry) => suggestsFallbackPitch(entry.noteText));

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-semibold text-foreground">{client.name}</h1>
            <p className="text-sm text-muted-foreground">
              <PhoneLink phone={client.phone} />
            </p>
          </div>
          <StatusBadge status={client.status} />
        </div>

        {fallbackPitch && (
          <div className="mt-4 rounded bg-gold/15 px-3 py-2 text-sm text-gold dark:text-gold-bright">
            This client may not be into modern certified coins — consider pitching Double Eagles
            as a bullion alternative.
          </div>
        )}

        {client.status === "CALLBACK" && client.callbackScheduledAt && (
          <div className="mt-4 rounded bg-gold/15 px-3 py-2 text-sm text-gold dark:text-gold-bright">
            Callback scheduled for {formatCallbackTime(client.callbackScheduledAt)}
          </div>
        )}

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Opener</dt>
            <dd className="text-foreground">{client.opener ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">First Sale Date</dt>
            <dd className="text-foreground">{formatDate(client.firstSaleDate)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">First Sale Amount</dt>
            <dd className="text-foreground">{formatCurrency(client.firstSaleAmount)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Days Left in Window</dt>
            <dd
              className={
                daysLeft <= 3 ? "font-semibold text-red-600 dark:text-red-400" : "text-foreground"
              }
            >
              {formatDaysLeft(daysLeft)}
            </dd>
          </div>
        </dl>

        {client.notes && (
          <div className="mt-5">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Notes
            </h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{client.notes}</p>
          </div>
        )}

        <div className="mt-5 border-t border-border pt-4">
          <AddToBookToggle clientId={client.id} initiallyInBook={!!client.bookClientId} />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-display text-lg font-semibold text-foreground">Add Call Log Entry</h2>
        <form action={addCallLogAction} className="mt-3 space-y-3">
          <input type="hidden" name="clientId" value={client.id} />
          <div>
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="noteText">
              What happened on the call?
            </label>
            <textarea
              id="noteText"
              name="noteText"
              required
              rows={3}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
            />
          </div>
          <CallbackScheduleFields
            defaultStatus={client.status}
            defaultDate={client.callbackScheduledAt?.split("T")[0]}
            defaultTime={client.callbackScheduledAt?.split("T")[1]}
          />
          <button
            type="submit"
            className="rounded bg-gold px-4 py-2 text-sm font-medium text-brand-black transition-opacity hover:opacity-90"
          >
            Log Call
          </button>
        </form>
      </div>

      <div>
        <h2 className="font-display text-lg font-semibold text-foreground">Call Log History</h2>
        {client.callLogEntries.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No calls logged yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {client.callLogEntries.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatDateTime(entry.timestamp)}</span>
                  <StatusBadge status={entry.resultingStatus} />
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{entry.noteText}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
