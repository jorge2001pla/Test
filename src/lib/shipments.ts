import { randomUUID } from "node:crypto";
import db, { ready } from "./db";
import { localDateTimeString, nowET } from "./business-logic";
import type { ClientStatus } from "./types";


export type Carrier = "USPS" | "FedEx" | "Other";

export const CARRIERS: Carrier[] = ["USPS", "FedEx", "Other"];

export interface Shipment {
  id: string;
  bookClientId: string;
  carrier: Carrier;
  trackingLink: string;
  notes: string | null;
  saleAmount: number | null;
  shippedAt: string;
  shippedCallDone: boolean;
  deliveredAt: string | null;
  deliveredCallDone: boolean;
  createdAt: string;
  updatedAt: string;
  partyId: string | null;
  orderId: string | null;
  expectedDelivery: string | null;
  deliveredDate: string | null;
  receiptConfirmedAt: string | null;
  exception: string | null;
  exceptionResolvedAt: string | null;
}

export interface ShipmentWithClient extends Shipment {
  clientName: string;
  clientPhone: string | null;
  clientStatus: ClientStatus;
}

interface ShipmentRowDb {
  id: string;
  book_client_id: string;
  carrier: Carrier;
  tracking_link: string;
  notes: string | null;
  sale_amount: number | null;
  shipped_at: string;
  shipped_call_done: number;
  delivered_at: string | null;
  delivered_call_done: number;
  created_at: string;
  updated_at: string;
  party_id: string | null;
  order_id: string | null;
  expected_delivery: string | null;
  delivered_date: string | null;
  receipt_confirmed_at: string | null;
  exception: string | null;
  exception_resolved_at: string | null;
}

function mapShipment(row: ShipmentRowDb): Shipment {
  return {
    id: row.id,
    bookClientId: row.book_client_id,
    carrier: row.carrier,
    trackingLink: row.tracking_link,
    notes: row.notes,
    saleAmount: row.sale_amount,
    shippedAt: row.shipped_at,
    shippedCallDone: !!row.shipped_call_done,
    deliveredAt: row.delivered_at,
    deliveredCallDone: !!row.delivered_call_done,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    partyId: row.party_id ?? null,
    orderId: row.order_id ?? null,
    expectedDelivery: row.expected_delivery ?? null,
    deliveredDate: row.delivered_date ?? null,
    receiptConfirmedAt: row.receipt_confirmed_at ?? null,
    exception: row.exception ?? null,
    exceptionResolvedAt: row.exception_resolved_at ?? null,
  };
}

/** True while a shipment still needs attention: not delivered, delivered but receipt unconfirmed,
 * or carrying an unresolved issue. (Receipt confirmation, not an unanswered call, closes it.) */
export function shipmentNeedsAttention(s: Shipment): boolean {
  return !s.deliveredAt || !s.receiptConfirmedAt || (!!s.exception && !s.exceptionResolvedAt);
}

export async function listShipmentsForClient(bookClientId: string): Promise<Shipment[]> {
  await ready();
  const res = await db.execute({
    sql: "SELECT * FROM shipments WHERE book_client_id = ? ORDER BY shipped_at DESC",
    args: [bookClientId],
  });
  return (res.rows as unknown as ShipmentRowDb[]).map(mapShipment);
}

/** Shipments still needing at least one of the two calls (shipped or delivered). */
export async function listActiveShipments(): Promise<ShipmentWithClient[]> {
  await ready();
  const res = await db.execute(
    `SELECT s.*, b.first_name, b.last_name, b.phone, b.status
     FROM shipments s
     JOIN book_clients b ON b.id = s.book_client_id
     WHERE s.delivered_at IS NULL
        OR s.receipt_confirmed_at IS NULL
        OR (s.exception IS NOT NULL AND s.exception_resolved_at IS NULL)
     ORDER BY s.shipped_at ASC`
  );
  const rows = res.rows as unknown as (ShipmentRowDb & {
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    status: ClientStatus;
  })[];
  return rows.map((row) => ({
    ...mapShipment(row),
    clientName: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unnamed",
    clientPhone: row.phone,
    clientStatus: row.status,
  }));
}

/** Shipments with an actual call to make right now — shipped but not yet called about, or
 * delivered but not yet called about. Excludes shipments still in transit with nothing due yet
 * (that's what listActiveShipments' broader "in progress" tracking is for). */
export async function listShipmentsNeedingCallToday(): Promise<ShipmentWithClient[]> {
  await ready();
  const res = await db.execute(
    `SELECT s.*, b.first_name, b.last_name, b.phone, b.status
     FROM shipments s
     JOIN book_clients b ON b.id = s.book_client_id
     WHERE s.shipped_call_done = 0
        OR (s.delivered_at IS NOT NULL AND s.delivered_call_done = 0)
     ORDER BY s.shipped_at ASC`
  );
  const rows = res.rows as unknown as (ShipmentRowDb & {
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    status: ClientStatus;
  })[];
  return rows.map((row) => ({
    ...mapShipment(row),
    clientName: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unnamed",
    clientPhone: row.phone,
    clientStatus: row.status,
  }));
}

export interface NewShipmentInput {
  bookClientId: string;
  carrier: Carrier;
  trackingLink: string;
  notes?: string | null;
  saleAmount?: number | null;
}

export async function createShipment(input: NewShipmentInput): Promise<Shipment> {
  await ready();
  const id = randomUUID();
  const now = localDateTimeString();
  const statements = [
    {
      sql: `INSERT INTO shipments (id, book_client_id, carrier, tracking_link, notes, sale_amount, shipped_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.bookClientId,
        input.carrier,
        input.trackingLink,
        input.notes ?? null,
        input.saleAmount ?? null,
        now,
        now,
        now,
      ],
    },
  ];
  if (input.saleAmount) {
    statements.push({
      sql: `UPDATE book_clients SET lifetime_value = lifetime_value + ?, updated_at = datetime('now') WHERE id = ?`,
      args: [input.saleAmount, input.bookClientId],
    });
  }
  await db.batch(statements, "write");
  const res = await db.execute({ sql: "SELECT * FROM shipments WHERE id = ?", args: [id] });
  return mapShipment(res.rows[0] as unknown as ShipmentRowDb);
}

export async function setShippedCallDone(id: string, done: boolean): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE shipments SET shipped_call_done = ?, updated_at = ? WHERE id = ?`,
    args: [done ? 1 : 0, localDateTimeString(), id],
  });
}

export async function markDelivered(id: string): Promise<void> {
  await ready();
  const nowDate = nowET();
  const now = localDateTimeString(nowDate);

  const res = await db.execute({
    sql: `SELECT s.book_client_id, s.sale_amount, s.delivered_at, b.first_name, b.last_name
          FROM shipments s
          JOIN book_clients b ON b.id = s.book_client_id
          WHERE s.id = ?`,
    args: [id],
  });
  const row = res.rows[0] as unknown as
    | {
        book_client_id: string;
        sale_amount: number | null;
        delivered_at: string | null;
        first_name: string | null;
        last_name: string | null;
      }
    | undefined;
  if (!row) return;

  const statements: { sql: string; args: (string | null)[] }[] = [
    {
      sql: `UPDATE shipments SET delivered_at = ?, updated_at = ? WHERE id = ?`,
      args: [now, now, id],
    },
  ];

  // Delivery check-ins are persistent follow-up tasks now (see followup/shipping.ts recordDelivery);
  // the old auto-created +1d / +5d reminders are retired.
  void row;

  await db.batch(statements, "write");
}

export async function setDeliveredCallDone(id: string, done: boolean): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE shipments SET delivered_call_done = ?, updated_at = ? WHERE id = ?`,
    args: [done ? 1 : 0, localDateTimeString(), id],
  });
}
