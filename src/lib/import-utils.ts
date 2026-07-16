import { CLIENT_STATUSES, type ClientStatus } from "./types";

export const TARGET_FIELDS = [
  "name",
  "phone",
  "opener",
  "firstSaleDate",
  "firstSaleAmount",
  "status",
  "notes",
  "callNotes",
] as const;

export type TargetField = (typeof TARGET_FIELDS)[number];

export const TARGET_FIELD_LABELS: Record<TargetField, string> = {
  name: "Client Name",
  phone: "Phone Number",
  opener: "Opener",
  firstSaleDate: "First Sale Date",
  firstSaleAmount: "First Sale Amount",
  status: "Status / Disposition",
  notes: "Notes",
  callNotes: "Call Notes (folded into Notes)",
};

const GUESS_KEYWORDS: Record<TargetField, string[]> = {
  name: ["client name", "name"],
  phone: ["client #", "client number", "phone"],
  opener: ["opener"],
  firstSaleDate: ["date"],
  firstSaleAmount: ["total sales", "sale amount", "amount"],
  status: ["disposition", "status"],
  notes: ["notes"],
  callNotes: ["call notes", "call note"],
};

/** Best-guess a source column index for each target field, based on header text. */
export function guessColumnMapping(headers: string[]): Record<TargetField, number | null> {
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
  const mapping = {} as Record<TargetField, number | null>;
  const used = new Set<number>();

  for (const field of TARGET_FIELDS) {
    const keywords = GUESS_KEYWORDS[field];
    let found: number | null = null;
    for (const keyword of keywords) {
      const idx = lowerHeaders.findIndex((h, i) => h.includes(keyword) && !used.has(i));
      if (idx !== -1) {
        found = idx;
        break;
      }
    }
    mapping[field] = found;
    if (found !== null) used.add(found);
  }

  return mapping;
}

export function normalizeStatus(raw: unknown): ClientStatus {
  const str = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (str === "NA" || str === "N_A") return "NOT_AVAILABLE";
  if ((CLIENT_STATUSES as string[]).includes(str)) return str as ClientStatus;
  return "NO_DISPO";
}

export function normalizeDate(raw: unknown): string {
  if (raw instanceof Date) {
    return raw.toISOString().slice(0, 10);
  }
  const str = String(raw ?? "").trim();
  if (!str) return "";
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return "";
}

export function normalizeAmount(raw: unknown): number | undefined {
  const str = String(raw ?? "").replace(/[^0-9.-]/g, "");
  if (!str) return undefined;
  const num = Number(str);
  return Number.isFinite(num) ? num : undefined;
}
