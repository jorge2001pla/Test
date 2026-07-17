import { randomUUID } from "node:crypto";
import db, { ready } from "./db";
import { localDateTimeString } from "./business-logic";
import type { ClientStatus } from "./types";

export type Carrier = "USPS" | "FedEx" | "Other";

export const CARRIERS: Carrier[] = ["USPS", "FedEx", "Other"];

export interface Shipment {
  id: string;
  bookClientId: string;
  carrier: Carrier;
  trackingLink: string;
  notes: string | null;
  shippedAt: string;
  shippedCallDone: boolean;
  deliveredAt: string | null;
  deliveredCallDone: boolean;
  createdAt: string;
  updatedAt: string;
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
  shipped_at: string;
  shipped_call_done: number;
  delivered_at: string | null;
  delivered_call_done: number;
  created_at: string;
  updated_at: string;
}

function mapShipment(row: ShipmentRowDb): Shipment {
  return {
    id: row.id,
    bookClientId: row.book_client_id,
    carrier: row.carrier,
    trackingLink: row.tracking_link,
    notes: row.notes,
    shippedAt: row.shipped_at,
    shippedCallDone: !!row.shipped_call_done,
    deliveredAt: row.delivered_at,
    deliveredCallDone: !!row.delivered_call_done,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
     WHERE s.shipped_call_done = 0
        OR s.delivered_at IS NULL
        OR s.delivered_call_done = 0
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
}

export async function createShipment(input: NewShipmentInput): Promise<Shipment> {
  await ready();
  const id = randomUUID();
  const now = localDateTimeString();
  await db.execute({
    sql: `INSERT INTO shipments (id, book_client_id, carrier, tracking_link, notes, shipped_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, input.bookClientId, input.carrier, input.trackingLink, input.notes ?? null, now, now, now],
  });
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
  const now = localDateTimeString();
  await db.execute({
    sql: `UPDATE shipments SET delivered_at = ?, updated_at = ? WHERE id = ?`,
    args: [now, now, id],
  });
}

export async function setDeliveredCallDone(id: string, done: boolean): Promise<void> {
  await ready();
  await db.execute({
    sql: `UPDATE shipments SET delivered_call_done = ?, updated_at = ? WHERE id = ?`,
    args: [done ? 1 : 0, localDateTimeString(), id],
  });
}
