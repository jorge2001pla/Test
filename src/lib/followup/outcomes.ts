/**
 * Contact outcomes → what they mean (attempt vs conversation), what legacy disposition they map
 * to, and what next action they demand. Pure. The legacy 5-state disposition (colors) is kept but
 * is only one of several separate statuses — cycle, shipment, task and restrictions are separate.
 */
import type { ClientStatus } from "../types";

export const CHANNELS = ["DIALER_CALL", "CELL_CALL", "TEXT", "EMAIL"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, string> = {
  DIALER_CALL: "Dialer call",
  CELL_CALL: "Cell call",
  TEXT: "Text",
  EMAIL: "Email",
};
export const isCall = (c: string) => c === "DIALER_CALL" || c === "CELL_CALL";

export const OUTCOMES = [
  "NO_ANSWER",
  "AI_SCREENING",
  "SPOKE",
  "SHIPPING_UPDATE",
  "CALLBACK_SET",
  "DECLINED",
  "SOLD",
  "DELIVERY_CONFIRMED",
  "SENT",
  "REPLIED",
  "STOP_CONTACT",
  "GHOST",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  NO_ANSWER: "No answer",
  AI_SCREENING: "AI screening / blocked",
  SPOKE: "Spoke — no result yet",
  SHIPPING_UPDATE: "Gave shipping update",
  CALLBACK_SET: "Callback requested",
  DECLINED: "Declined",
  SOLD: "Sold",
  DELIVERY_CONFIRMED: "Delivery confirmed by client",
  SENT: "Sent (text / email)",
  REPLIED: "Client replied",
  STOP_CONTACT: "Asked to stop contact",
  GHOST: "GHOST",
};

export const OBJECTIONS = [
  { key: "WRONG_PRODUCT", label: "Wrong product" },
  { key: "PRICE_BUDGET", label: "Price / budget" },
  { key: "TIMING", label: "Timing" },
  { key: "DECLINED_OFFER", label: "Declined this offer" },
  { key: "NO_FURTHER_CONTACT", label: "Requested no further contact" },
] as const;
export type ObjectionKey = (typeof OBJECTIONS)[number]["key"];

export interface OutcomeTraits {
  /** The contact was attempted (always true for anything logged). */
  attempted: boolean;
  /** A real two-way conversation happened. Opens/sends/no-answers never count. */
  reached: boolean;
  /** Legacy disposition this maps to, or null to leave it unchanged. */
  legacyStatus: ClientStatus | null;
  /** Needs the user to name a next action date/time. */
  needsNextDate: boolean;
  needsObjection: boolean;
  needsCallbackTime: boolean;
}

export function traits(outcome: Outcome, channel: Channel): OutcomeTraits {
  const call = isCall(channel);
  switch (outcome) {
    case "NO_ANSWER":
    case "AI_SCREENING":
      return t({ legacyStatus: call ? "NOT_AVAILABLE" : null });
    case "SPOKE":
      return t({ reached: true, legacyStatus: "NO_DISPO", needsNextDate: true });
    case "SHIPPING_UPDATE":
      return t({ reached: true, legacyStatus: null });
    case "CALLBACK_SET":
      return t({ reached: true, legacyStatus: "CALLBACK", needsCallbackTime: true });
    case "DECLINED":
      return t({ reached: true, legacyStatus: "NOT_INTERESTED", needsObjection: true, needsNextDate: true });
    case "SOLD":
      return t({ reached: true, legacyStatus: "SOLD" });
    case "DELIVERY_CONFIRMED":
      return t({ reached: true, legacyStatus: null });
    case "SENT":
      return t({ legacyStatus: null });
    case "REPLIED":
      return t({ reached: true, legacyStatus: null });
    case "STOP_CONTACT":
      return t({ reached: true, legacyStatus: "NOT_INTERESTED" });
    case "GHOST":
      return t({ legacyStatus: "NOT_INTERESTED" });
  }
}

function t(p: Partial<OutcomeTraits>): OutcomeTraits {
  return {
    attempted: true,
    reached: false,
    legacyStatus: null,
    needsNextDate: false,
    needsObjection: false,
    needsCallbackTime: false,
    ...p,
  };
}

/** Quick presets for the one-tap Log Contact form (colors Jorge already knows). */
export const PRESETS: { key: string; label: string; outcome: Outcome; color: string; voicemail?: boolean }[] = [
  { key: "no_answer", label: "No answer", outcome: "NO_ANSWER", color: "yellow" },
  { key: "vm", label: "No answer + voicemail", outcome: "NO_ANSWER", color: "yellow", voicemail: true },
  { key: "ai", label: "AI screening", outcome: "AI_SCREENING", color: "yellow" },
  { key: "spoke", label: "Spoke", outcome: "SPOKE", color: "gray" },
  { key: "callback", label: "Callback", outcome: "CALLBACK_SET", color: "blue" },
  { key: "declined", label: "Declined", outcome: "DECLINED", color: "red" },
  { key: "sold", label: "Sold", outcome: "SOLD", color: "green" },
];

export function validateContactInput(i: {
  outcome: Outcome;
  channel: Channel;
  objection?: string | null;
  nextActionDate?: string | null;
  callbackAt?: string | null;
}): string | null {
  const tr = traits(i.outcome, i.channel);
  if (tr.needsObjection && !OBJECTIONS.some((o) => o.key === i.objection)) {
    return "Pick an objection category for a declined contact.";
  }
  if (i.outcome === "DECLINED" && i.objection === "NO_FURTHER_CONTACT") {
    return "“Stop contacting me” isn’t an ordinary objection — use the “Asked to stop contact” outcome.";
  }
  if (tr.needsCallbackTime && !i.callbackAt) return "Pick the callback date and time.";
  if (tr.needsNextDate && !i.nextActionDate) return "Pick the next action date.";
  return null;
}
