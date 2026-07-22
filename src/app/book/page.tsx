import Link from "next/link";
import { listBookClients } from "@/lib/book";
import BookClientTable from "@/components/BookClientTable";

export const dynamic = "force-dynamic";

export default async function BookPage() {
  const clients = await listBookClients();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your existing client book ({clients.length} clients).
          </p>
        </div>
        <Link
          href="/book/new"
          className="rounded bg-gold px-4 py-2 text-sm font-medium text-brand-black transition-opacity hover:opacity-90"
        >
          + Add Client to Book
        </Link>
      </div>

      <BookClientTable clients={clients} />
    </div>
  );
}
