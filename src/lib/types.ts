export type ClientStatus = "NO_DISPO" | "CALLBACK" | "NOT_AVAILABLE" | "NOT_INTERESTED" | "SOLD";

export const CLIENT_STATUSES: ClientStatus[] = [
  "NO_DISPO",
  "CALLBACK",
  "NOT_AVAILABLE",
  "NOT_INTERESTED",
  "SOLD",
];

export const STATUS_LABELS: Record<ClientStatus, string> = {
  NO_DISPO: "No Dispo",
  CALLBACK: "Callback",
  NOT_AVAILABLE: "Not Available",
  NOT_INTERESTED: "Not Interested",
  SOLD: "Sold",
};

export type Qualification = "UNKNOWN" | "QUALIFIED";

/** Product-interest categories — key is what's stored, tag is the compact dashboard
 * label, label is the full text shown in the edit UI. */
export const PRODUCT_INTERESTS = [
  { key: "SILVER", tag: "SILVER", label: "Silver Bullion" },
  { key: "GOLD", tag: "GOLD", label: "Gold Bullion" },
  { key: "MODERN", tag: "MODERN", label: "Modern Collectibles" },
  { key: "OLDER_RARE", tag: "OLDER/RARE", label: "Older / Rare Collectibles" },
  { key: "SHIPWRECK", tag: "SHIPWRECK", label: "Shipwreck / Historical" },
] as const;

export type ProductInterestKey = (typeof PRODUCT_INTERESTS)[number]["key"];

/** The four manually-tracked onboarding emails (no Klaviyo integration in V1). */
export const ONBOARDING_EMAILS = [
  { key: "WELCOME", label: "Welcome Email" },
  { key: "MORGAN", label: "Morgan Silver Package" },
  { key: "DOUBLE_EAGLE", label: "Double Eagle Package" },
  { key: "TOP_COINS", label: "Top Coins In-House" },
] as const;

export type OnboardingEmailKey = (typeof ONBOARDING_EMAILS)[number]["key"];

export interface Client {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  qualification: Qualification;
  productInterests: ProductInterestKey[];
  onboardingEmails: OnboardingEmailKey[];
  opener: string | null;
  firstSaleDate: string;
  firstSaleAmount: number | null;
  status: ClientStatus;
  notes: string | null;
  bookClientId: string | null;
  callbackScheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CallLogEntry {
  id: string;
  clientId: string;
  timestamp: string;
  noteText: string;
  resultingStatus: ClientStatus;
}

export interface ClientWithCallLog extends Client {
  callLogEntries: CallLogEntry[];
}
