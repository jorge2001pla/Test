"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createClient,
  getClient,
  linkClientToBook,
  unlinkClientFromBook,
  updateClientDetails,
  updateClientProfileExtras,
  type ClientDetailsUpdate,
  type ClientProfileExtras,
  type NewClientInput,
} from "@/lib/clients";
import {
  createBookClient,
  deleteBookClient,
  getBookClient,
  listBookClients,
  setLifetimeValue,
  updateBookClientDetails,
  type BookClientDetailsUpdate,
} from "@/lib/book";
import {
  createShipment,
  CARRIERS,
  type Carrier,
} from "@/lib/shipments";
import { createReminder, deleteReminder, setReminderDone } from "@/lib/reminders";
import { createNote, deleteNote } from "@/lib/notes";
import {
  createPromotion,
  endPromotion,
  markAllEmailed,
  markAllTexted,
  reactivatePromotion,
  type PromotionKind,
} from "@/lib/promotions";
import { onShipmentCreated } from "@/lib/followup/shipping";
import { ensureBookClient, ensurePartyForClient, run } from "@/lib/followup/store";
import { isOwnerOpener } from "@/lib/owner";
import type { ClientStatus } from "@/lib/types";
import { CLIENT_STATUSES } from "@/lib/types";

function parseStatus(
  value: FormDataEntryValue | string | null | undefined,
  fallback: ClientStatus
): ClientStatus {
  const str = String(value ?? "");
  return (CLIENT_STATUSES as string[]).includes(str) ? (str as ClientStatus) : fallback;
}

export async function createClientAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const opener = String(formData.get("opener") ?? "").trim();
  const firstSaleDate = String(formData.get("firstSaleDate") ?? "");
  const firstSaleAmountRaw = String(formData.get("firstSaleAmount") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  const status = parseStatus(formData.get("status"), "NO_DISPO");

  if (!name || !phone || !firstSaleDate) {
    throw new Error("Name, phone, and first sale date are required.");
  }

  const input: NewClientInput = {
    name,
    phone,
    email: email || null,
    opener: opener || null,
    firstSaleDate,
    firstSaleAmount: firstSaleAmountRaw ? Number(firstSaleAmountRaw) : null,
    status,
    notes: notes || null,
  };

  const created = await createClient(input);
  // An account Jorge opened goes straight into his book and the follow-up system.
  if (isOwnerOpener(input.opener)) {
    const partyId = await ensurePartyForClient(created.id);
    if (partyId) await ensureBookClient(partyId);
  }
  revalidatePath("/");
  revalidatePath("/follow-up");
  redirect("/follow-up");
}

export interface ImportRow {
  name: string;
  phone: string;
  opener?: string;
  firstSaleDate: string;
  firstSaleAmount?: number;
  status?: string;
  notes?: string;
}

export async function importClientsAction(rows: ImportRow[]): Promise<{ imported: number }> {
  let imported = 0;
  for (const row of rows) {
    if (!row.name || !row.phone || !row.firstSaleDate) continue;
    await createClient({
      name: row.name,
      phone: row.phone,
      opener: row.opener || null,
      firstSaleDate: row.firstSaleDate,
      firstSaleAmount: row.firstSaleAmount ?? null,
      status: parseStatus(row.status, "NO_DISPO"),
      notes: row.notes || null,
    });
    imported += 1;
  }
  revalidatePath("/");
  return { imported };
}

export async function createBookClientAction(formData: FormData): Promise<void> {
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const secondaryPhone = String(formData.get("secondaryPhone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!firstName && !lastName) {
    throw new Error("Name is required.");
  }

  const bookClient = await createBookClient({
    firstName: firstName || null,
    lastName: lastName || null,
    phone: phone || null,
    secondaryPhone: secondaryPhone || null,
    email: email || null,
    notes: notes || null,
  });
  revalidatePath("/");
  revalidatePath("/book");
  redirect(`/book/${bookClient.id}`);
}

export async function addClientToBookAction(clientId: string): Promise<void> {
  const client = await getClient(clientId);
  if (!client) throw new Error("Client not found");

  const [firstName, ...rest] = client.name.trim().split(/\s+/);
  const bookClient = await createBookClient({
    firstName: firstName || null,
    lastName: rest.join(" ") || null,
    phone: client.phone,
    email: client.email,
  });
  await linkClientToBook(clientId, bookClient.id);
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/book");
  revalidatePath("/");
}

export async function removeClientFromBookAction(clientId: string): Promise<void> {
  const client = await getClient(clientId);
  if (!client?.bookClientId) return;

  await deleteBookClient(client.bookClientId);
  await unlinkClientFromBook(clientId);
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/book");
  revalidatePath("/");
}

export async function createShipmentAction(formData: FormData): Promise<void> {
  const bookClientId = String(formData.get("bookClientId") ?? "");
  const carrierRaw = String(formData.get("carrier") ?? "");
  const trackingLink = String(formData.get("trackingLink") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const saleAmountRaw = String(formData.get("saleAmount") ?? "").trim();

  if (!bookClientId || !trackingLink) {
    throw new Error("Tracking link is required.");
  }

  const client = await getBookClient(bookClientId);
  if (!client) throw new Error("Client not found");

  const shipment = await createShipment({
    bookClientId,
    carrier: (CARRIERS as string[]).includes(carrierRaw) ? (carrierRaw as Carrier) : "Other",
    trackingLink,
    notes: notes || null,
    saleAmount: saleAmountRaw ? Number(saleAmountRaw) : null,
  });
  // Tie the shipment to the canonical client + order and queue the "shipped" call.
  await onShipmentCreated(shipment.id);
  revalidatePath("/");
  revalidatePath("/queue");
  revalidatePath(`/book/${bookClientId}`);
}

export async function updateClientDetailsAction(
  clientId: string,
  d: ClientDetailsUpdate
): Promise<void> {
  if (!clientId || !d.name.trim() || !d.phone.trim() || !d.firstSaleDate) {
    throw new Error("Name, phone, and first sale date are required.");
  }
  await updateClientDetails(clientId, {
    ...d,
    name: d.name.trim(),
    phone: d.phone.trim(),
    email: d.email?.trim() || null,
    opener: d.opener?.trim() || null,
  });
  if (isOwnerOpener(d.opener)) {
    const partyId = await ensurePartyForClient(clientId);
    if (partyId) await ensureBookClient(partyId);
  }
  // The first sale date IS the opening date for 50%-list accounts — keep the canonical record in
  // step, unless the opening date was set by hand on the follow-up panel.
  await run([
    {
      sql: `UPDATE parties SET opening_date = ?, updated_at = ?
            WHERE id = (SELECT party_id FROM clients WHERE id = ?)
              AND (opening_date_source IS NULL OR opening_date_source = 'clients.first_sale_date')`,
      args: [d.firstSaleDate.slice(0, 10), new Date().toISOString(), clientId],
    },
  ]);
  revalidatePath("/");
  revalidatePath("/follow-up");
  revalidatePath(`/clients/${clientId}`);
}

export async function updateClientProfileExtrasAction(
  clientId: string,
  extras: ClientProfileExtras
): Promise<void> {
  if (!clientId) throw new Error("Missing client.");
  await updateClientProfileExtras(clientId, extras);
  revalidatePath("/follow-up");
  revalidatePath(`/clients/${clientId}`);
}

export async function updateBookClientDetailsAction(
  bookClientId: string,
  d: BookClientDetailsUpdate
): Promise<void> {
  if (!bookClientId || (!d.firstName?.trim() && !d.lastName?.trim())) {
    throw new Error("A first or last name is required.");
  }
  await updateBookClientDetails(bookClientId, {
    firstName: d.firstName?.trim() || null,
    lastName: d.lastName?.trim() || null,
    phone: d.phone?.trim() || null,
    secondaryPhone: d.secondaryPhone?.trim() || null,
    email: d.email?.trim() || null,
  });
  revalidatePath("/");
  revalidatePath("/book");
  revalidatePath(`/book/${bookClientId}`);
}

export async function createReminderAction(formData: FormData): Promise<void> {
  const text = String(formData.get("text") ?? "").trim();
  const dueDate = String(formData.get("dueDate") ?? "").trim();

  if (!text) {
    throw new Error("Reminder text is required.");
  }

  await createReminder(text, dueDate || null);
  revalidatePath("/");
}

export async function setReminderDoneAction(id: string, done: boolean): Promise<void> {
  await setReminderDone(id, done);
  revalidatePath("/");
}

export async function deleteReminderAction(id: string): Promise<void> {
  await deleteReminder(id);
  revalidatePath("/");
}

export async function createNoteAction(formData: FormData): Promise<void> {
  const text = String(formData.get("text") ?? "").trim();

  if (!text) {
    throw new Error("Note text is required.");
  }

  await createNote(text);
  revalidatePath("/");
}

export async function deleteNoteAction(id: string): Promise<void> {
  await deleteNote(id);
  revalidatePath("/");
}

export async function updateLifetimeValueAction(bookClientId: string, value: number): Promise<void> {
  if (!bookClientId || !Number.isFinite(value) || value < 0) {
    throw new Error("A valid value is required.");
  }
  await setLifetimeValue(bookClientId, value);
  revalidatePath("/");
  revalidatePath(`/book/${bookClientId}`);
  revalidatePath("/book");
  revalidatePath("/reactivate");
}

export async function createPromotionAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const kind: PromotionKind = String(formData.get("kind") ?? "") === "COIN_OF_WEEK" ? "COIN_OF_WEEK" : "PROMOTION";
  if (!name) {
    throw new Error("Campaign name is required.");
  }
  await createPromotion(name, description || null, kind);
  revalidatePath("/");
  revalidatePath("/campaigns");
}

export async function markAllEmailedAction(promotionId: string): Promise<void> {
  await markAllEmailed(promotionId);
  revalidatePath("/campaigns");
}

export async function markAllTextedAction(promotionId: string): Promise<void> {
  await markAllTexted(promotionId);
  revalidatePath("/campaigns");
}

export async function endPromotionAction(promotionId: string): Promise<void> {
  await endPromotion(promotionId);
  revalidatePath("/");
  revalidatePath("/campaigns");
}

export async function reactivatePromotionAction(promotionId: string): Promise<void> {
  await reactivatePromotion(promotionId);
  revalidatePath("/");
  revalidatePath("/campaigns");
}

export interface ValueImportRow {
  name: string;
  phone?: string;
  value: number;
}

export interface ValueImportResult {
  matched: number;
  unmatched: string[];
}

/** Matches CRM export rows against the existing book by phone first, then exact name, and sets
 * each matched client's lifetime value. Returns names that couldn't be matched to anyone. */
export async function importClientValuesAction(rows: ValueImportRow[]): Promise<ValueImportResult> {
  const existing = await listBookClients();
  const byPhone = new Map<string, (typeof existing)[number]>();
  const byName = new Map<string, (typeof existing)[number]>();
  const digitsOnly = (s: string) => s.replace(/\D/g, "");
  for (const c of existing) {
    if (c.phone) byPhone.set(digitsOnly(c.phone), c);
    const full = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim().toLowerCase();
    if (full) byName.set(full, c);
  }

  let matched = 0;
  const unmatched: string[] = [];

  for (const row of rows) {
    if (!row.name || !Number.isFinite(row.value)) continue;
    const client =
      (row.phone && byPhone.get(digitsOnly(row.phone))) || byName.get(row.name.trim().toLowerCase());
    if (client) {
      await setLifetimeValue(client.id, row.value);
      matched += 1;
    } else {
      unmatched.push(row.name);
    }
  }

  revalidatePath("/");
  revalidatePath("/book");
  revalidatePath("/reactivate");
  return { matched, unmatched };
}
