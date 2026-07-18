import CampaignBoard from "@/components/CampaignBoard";

export const dynamic = "force-dynamic";

export default function CampaignsPage() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">Campaigns</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything you&apos;re pushing to the book right now — email (Klaviyo), text, and calls.
          One call clears a client from every active campaign.
        </p>
      </div>

      <CampaignBoard
        kind="PROMOTION"
        copy={{
          title: "Promotion",
          subtitle:
            "Your main push — make sure every client gets all three touches, then reset and start the next one.",
          startLabel: "Promotion",
          namePlaceholder: "e.g. Liberty Bell Gold Coin — July 2026",
        }}
      />

      <div className="border-t border-border" />

      <CampaignBoard
        kind="COIN_OF_WEEK"
        copy={{
          title: "Coin of the Week",
          subtitle:
            "This week's featured coin — runs until the week's over or the coin sells, then start the next one.",
          startLabel: "Coin of the Week",
          namePlaceholder: "e.g. 1893-S Morgan Silver Dollar",
        }}
      />
    </div>
  );
}
