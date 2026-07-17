import { notFound } from "next/navigation";
import Link from "next/link";
import { getBookClient } from "@/lib/book";
import { listShipmentsForClient, CARRIERS } from "@/lib/shipments";
import { formatCallbackTime, formatDate, formatDateTime } from "@/lib/format";
import { suggestsFallbackPitch } from "@/lib/business-logic";
import StatusBadge from "@/components/StatusBadge";
import CallbackScheduleFields from "@/components/CallbackScheduleFields";
import ShipmentActions from "@/components/ShipmentActions";
import { addBookCallLogAction, createShipmentAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function BookClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await getBookClient(id);
  if (!client) notFound();

  const name = [client.firstName, client.lastName].filter(Boolean).join(" ") || "Unnamed";
  const shipments = await listShipmentsForClient(client.id);
  const fallbackPitch =
    suggestsFallbackPitch(client.notes) ||
    client.callLogEntries.some((entry) => suggestsFallbackPitch(entry.noteText));

  return (
    <div className="space-y-8">
      <Link href="/book" className="text-sm text-muted-foreground hover:text-gold">
        ← Back to Clients
      </Link>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-semibold text-foreground">{name}</h1>
            <p className="text-sm text-muted-foreground">{client.phone ?? "—"}</p>
            {client.secondaryPhone && (
              <p className="text-sm text-muted-foreground">{client.secondaryPhone} (secondary)</p>
            )}
            {client.email && <p className="text-sm text-muted-foreground">{client.email}</p>}
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

        {client.notes && (
          <div className="mt-5">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Notes
            </h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{client.notes}</p>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-display text-lg font-semibold text-foreground">Shipments</h2>
        <form action={createShipmentAction} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="bookClientId" value={client.id} />
          <div>
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="carrier">
              Carrier
            </label>
            <select
              id="carrier"
              name="carrier"
              defaultValue="USPS"
              className="rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
            >
              {CARRIERS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="trackingNumber">
              Tracking Number
            </label>
            <input
              id="trackingNumber"
              name="trackingNumber"
              type="text"
              required
              className="rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
            />
          </div>
          <div className="flex-1 min-w-[10rem]">
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="shipmentNotes">
              Notes
            </label>
            <input
              id="shipmentNotes"
              name="notes"
              type="text"
              placeholder="Optional"
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="rounded bg-gold px-4 py-2 text-sm font-medium text-brand-black transition-opacity hover:opacity-90"
          >
            Add Shipment
          </button>
        </form>

        {shipments.length > 0 && (
          <ul className="mt-4 space-y-3">
            {shipments.map((s) => (
              <li key={s.id} className="rounded border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-foreground">
                    {s.carrier} — {s.trackingNumber}
                  </span>
                  <span className="text-muted-foreground">
                    Shipped {formatDate(s.shippedAt)}
                    {s.deliveredAt && ` · Delivered ${formatDate(s.deliveredAt)}`}
                  </span>
                </div>
                {s.notes && <p className="mt-1 text-sm text-muted-foreground">{s.notes}</p>}
                <div className="mt-2">
                  <ShipmentActions
                    shipmentId={s.id}
                    bookClientId={client.id}
                    shippedCallDone={s.shippedCallDone}
                    deliveredAt={s.deliveredAt}
                    deliveredCallDone={s.deliveredCallDone}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-display text-lg font-semibold text-foreground">Add Call Log Entry</h2>
        <form action={addBookCallLogAction} className="mt-3 space-y-3">
          <input type="hidden" name="bookClientId" value={client.id} />
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
