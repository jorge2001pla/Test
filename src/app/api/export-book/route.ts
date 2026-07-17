import { listBookClients } from "@/lib/book";

function csvCell(value: string | number | null): string {
  const str = value == null ? "" : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET() {
  const clients = await listBookClients();

  const header = ["First Name", "Last Name", "Email", "Phone", "Secondary Phone", "Status", "Lifetime Value"];
  const lines = [header.map(csvCell).join(",")];
  for (const c of clients) {
    lines.push(
      [c.firstName, c.lastName, c.email, c.phone, c.secondaryPhone, c.status, c.lifetimeValue]
        .map(csvCell)
        .join(",")
    );
  }
  const csv = lines.join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="client-book-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
