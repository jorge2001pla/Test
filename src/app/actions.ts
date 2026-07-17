"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addCallLogEntry,
  createClient,
  getClient,
  linkClientToBook,
  unlinkClientFromBook,
  type NewClientInput,
} from "@/lib/clients";
import {
  addBookCallLogEntry,
  createBookClient,
  deleteBookClient,
  getBookClient,
  listBookClients,
  setLifetimeValue,
} from "@/lib/book";
import {
  createShipment,
  markDelivered,
  setDeliveredCallDone,
  setShippedCallDone,
  CARRIERS,
  type Carrier,
} from "@/lib/shipments";
import { createReminder, deleteReminder, setReminderDone } from "@/lib/reminders";
import { createNote, deleteNote } from "@/lib/notes";
import {
  createPromotion,
  endPromotion,
  getActivePromotion,
  markAllEmailed,
  markAllTexted,
} from "@/lib/promotions";
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
    opener: opener || null,
    firstSaleDate,
    firstSaleAmount: firstSaleAmountRaw ? Number(firstSaleAmountRaw) : null,
    status,
    notes: notes || null,
  };

  await createClient(input);
  revalidatePath("/");
  revalidatePath("/follow-up");
  redirect("/follow-up");
}

export async function addCallLogAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get("clientId") ?? "");
  const noteText = String(formData.get("noteText") ?? "").trim();
  const resultingStatus = parseStatus(formData.get("resultingStatus"), "CALLBACK");
  const scheduledDate = String(formData.get("callbackDate") ?? "").trim();
  const scheduledTime = String(formData.get("callbackTime") ?? "").trim();

  if (!clientId || !noteText) {
    throw new Error("A call note is required.");
  }

  const callbackScheduledAt =
    resultingStatus === "CALLBACK" && scheduledDate && scheduledTime
      ? `${scheduledDate}T${scheduledTime}`
      : null;

  await addCallLogEntry(clientId, noteText, resultingStatus, callbackScheduledAt);
  revalidatePath("/");
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}

export async function addBookCallLogAction(formData: FormData): Promise<void> {
  const bookClientId = String(formData.get("bookClientId") ?? "");
  const noteText = String(formData.get("noteText") ?? "").trim();
  const resultingStatus = parseStatus(formData.get("resultingStatus"), "CALLBACK");
  const scheduledDate = String(formData.get("callbackDate") ?? "").trim();
  const scheduledTime = String(formData.get("callbackTime") ?? "").trim();

  if (!bookClientId || !noteText) {
    throw new Error("A call note is required.");
  }

  const callbackScheduledAt =
    resultingStatus === "CALLBACK" && scheduledDate && scheduledTime
      ? `${scheduledDate}T${scheduledTime}`
      : null;

  const activePromo = await getActivePromotion();
  await addBookCallLogEntry(
    bookClientId,
    noteText,
    resultingStatus,
    callbackScheduledAt,
    activePromo?.id ?? null
  );
  revalidatePath("/");
  revalidatePath(`/book/${bookClientId}`);
  revalidatePath("/book");
  redirect(`/book/${bookClientId}`);
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
    email: null,
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

  await createShipment({
    bookClientId,
    carrier: (CARRIERS as string[]).includes(carrierRaw) ? (carrierRaw as Carrier) : "Other",
    trackingLink,
    notes: notes || null,
    saleAmount: saleAmountRaw ? Number(saleAmountRaw) : null,
  });
  revalidatePath("/");
  revalidatePath(`/book/${bookClientId}`);
}

export async function setShippedCallDoneAction(
  shipmentId: string,
  bookClientId: string,
  done: boolean
): Promise<void> {
  await setShippedCallDone(shipmentId, done);
  revalidatePath("/");
  revalidatePath(`/book/${bookClientId}`);
}

export async function markDeliveredAction(shipmentId: string, bookClientId: string): Promise<void> {
  await markDelivered(shipmentId);
  revalidatePath("/");
  revalidatePath(`/book/${bookClientId}`);
}

export async function setDeliveredCallDoneAction(
  shipmentId: string,
  bookClientId: string,
  done: boolean
): Promise<void> {
  await setDeliveredCallDone(shipmentId, done);
  revalidatePath("/");
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

export interface QuickCallInput {
  id: string;
  noteText: string;
  resultingStatus: ClientStatus;
  callbackDate?: string;
  callbackTime?: string;
}

function callbackScheduledAtFrom(input: QuickCallInput): string | null {
  return input.resultingStatus === "CALLBACK" && input.callbackDate && input.callbackTime
    ? `${input.callbackDate}T${input.callbackTime}`
    : null;
}

/** Same as addCallLogAction but doesn't redirect — for logging a call inline from the Dashboard
 * without navigating away from the call queue. */
export async function quickLogCallAction(input: QuickCallInput): Promise<void> {
  const noteText = input.noteText.trim();
  if (!input.id || !noteText) {
    throw new Error("A call note is required.");
  }
  await addCallLogEntry(input.id, noteText, input.resultingStatus, callbackScheduledAtFrom(input));
  revalidatePath("/");
  revalidatePath(`/clients/${input.id}`);
}

/** Book-client counterpart to quickLogCallAction. */
export async function quickLogBookCallAction(input: QuickCallInput): Promise<void> {
  const noteText = input.noteText.trim();
  if (!input.id || !noteText) {
    throw new Error("A call note is required.");
  }
  const activePromo = await getActivePromotion();
  await addBookCallLogEntry(
    input.id,
    noteText,
    input.resultingStatus,
    callbackScheduledAtFrom(input),
    activePromo?.id ?? null
  );
  revalidatePath("/");
  revalidatePath(`/book/${input.id}`);
  revalidatePath("/book");
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
  if (!name) {
    throw new Error("Promotion name is required.");
  }
  await createPromotion(name, description || null);
  revalidatePath("/");
  revalidatePath("/promotions");
}

export async function markAllEmailedAction(promotionId: string): Promise<void> {
  await markAllEmailed(promotionId);
  revalidatePath("/promotions");
}

export async function markAllTextedAction(promotionId: string): Promise<void> {
  await markAllTexted(promotionId);
  revalidatePath("/promotions");
}

export async function endPromotionAction(promotionId: string): Promise<void> {
  await endPromotion(promotionId);
  revalidatePath("/");
  revalidatePath("/promotions");
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
