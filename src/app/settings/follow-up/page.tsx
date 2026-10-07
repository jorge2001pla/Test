import Link from "next/link";
import FollowUpSettingsForm from "@/components/FollowUpSettingsForm";
import { getConfig } from "@/lib/followup/store";

export const dynamic = "force-dynamic";

export default async function FollowUpSettingsPage() {
  const cfg = await getConfig();
  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted-foreground hover:text-gold">← Back to Dashboard</Link>
      <h1 className="font-display text-2xl font-semibold text-foreground">Follow-Up Rules</h1>
      <FollowUpSettingsForm initial={cfg} />
    </div>
  );
}
