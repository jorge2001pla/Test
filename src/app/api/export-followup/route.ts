import { listClients } from "@/lib/clients";

function csvCell(value: string | number | null): string {
  const str = value == null ? "" : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Klaviyo (and most email/SMS platforms) require E.164 phone format: +1XXXXXXXXXX.
 * Takes the first number when a field holds several ("...; ..."), strips formatting, and
 * prefixes +1 for 10-digit US numbers. Returns "" for anything that can't be normalized —
 * Klaviyo accepts a blank phone but rejects a malformed one. */
function toE164(phone: string | null): string {
  if (!phone) return "";
  const first = phone.split(";")[0];
  const digits = first.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

/** Klaviyo-ready export of the 50% list — only clients NOT linked into the book, so
 * combined with the book export there's no overlap between the two audiences. */
export async function GET() {
  const clients = await listClients();
  const notInBook = clients.filter((c) => !c.bookClientId);

  const header = ["First Name", "Last Name", "Email", "Phone Number", "Status", "Opener"];
  const lines = [header.map(csvCell).join(",")];
  for (const c of notInBook) {
    const [firstName, ...rest] = c.name.trim().split(/\s+/);
    lines.push(
      [firstName ?? "", rest.join(" "), c.email, toE164(c.phone), c.status, c.opener]
        .map(csvCell)
        .join(",")
    );
  }
  const csv = lines.join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="fifty-percent-list-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
