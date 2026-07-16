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

export interface Client {
  id: string;
  name: string;
  phone: string;
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
