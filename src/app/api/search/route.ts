import { NextRequest, NextResponse } from "next/server";
import { listBookClients } from "@/lib/book";
import { listClients } from "@/lib/clients";

export interface SearchResult {
  id: string;
  name: string;
  phone: string | null;
  kind: "book" | "client";
  status: string;
  href: string;
}

const digitsOnly = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

/** Global lookup across the book and the 15-day list — matches on name substring or phone
 * digits (so caller-ID numbers paste straight in). Small dataset, so filtering in JS is fine. */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }
  const qDigits = digitsOnly(q);
  const phoneSearch = qDigits.length >= 4;

  const [bookClients, clients] = await Promise.all([listBookClients(), listClients()]);

  const matches: SearchResult[] = [];

  for (const c of bookClients) {
    const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
    const nameHit = name.toLowerCase().includes(q);
    const phoneHit =
      phoneSearch &&
      (digitsOnly(c.phone).includes(qDigits) || digitsOnly(c.secondaryPhone).includes(qDigits));
    if (nameHit || phoneHit) {
      matches.push({
        id: c.id,
        name: name || "Unnamed",
        phone: c.phone,
        kind: "book",
        status: c.status,
        href: `/book/${c.id}`,
      });
    }
  }

  for (const c of clients) {
    const nameHit = c.name.toLowerCase().includes(q);
    const phoneHit = phoneSearch && digitsOnly(c.phone).includes(qDigits);
    // 15-day clients already linked into the book would double-list — prefer the book entry.
    if ((nameHit || phoneHit) && !c.bookClientId) {
      matches.push({
        id: c.id,
        name: c.name,
        phone: c.phone,
        kind: "client",
        status: c.status,
        href: `/clients/${c.id}`,
      });
    }
  }

  matches.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ results: matches.slice(0, 8) });
}
