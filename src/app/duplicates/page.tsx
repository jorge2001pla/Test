import Link from "next/link";
import DuplicateReview from "@/components/DuplicateReview";
import { findDuplicates } from "@/lib/followup/admin";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  const pairs = await findDuplicates();
  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted-foreground hover:text-gold">← Back to Dashboard</Link>
      <h1 className="font-display text-2xl font-semibold text-foreground">Duplicate Review</h1>
      <p className="text-sm text-muted-foreground">
        Pairs sharing a phone number or email. Names alone never count. Nothing merges unless you confirm, and merging deletes nothing.
        Run the one-time setup in Follow-Up Rules first so every record has a canonical client.
      </p>
      {pairs.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No duplicates found.</p> : <DuplicateReview pairs={pairs} />}
    </div>
  );
}
