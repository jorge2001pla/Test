import CampaignBoard from "@/components/CampaignBoard";

export const dynamic = "force-dynamic";

export default function PromotionsPage() {
  return (
    <CampaignBoard
      kind="PROMOTION"
      copy={{
        title: "Promotions",
        subtitle:
          "Track a promo push across email (Klaviyo), text, and calls — make sure every client gets all three, then reset and start the next one.",
        startLabel: "Promotion",
        namePlaceholder: "e.g. Liberty Bell Gold Coin — July 2026",
      }}
    />
  );
}
