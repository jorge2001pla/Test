import CampaignBoard from "@/components/CampaignBoard";

export const dynamic = "force-dynamic";

export default function CoinOfTheWeekPage() {
  return (
    <CampaignBoard
      kind="COIN_OF_WEEK"
      copy={{
        title: "Coin of the Week",
        subtitle:
          "This week's featured coin — email, text, and call the book on it. Runs until the week's over or the coin sells, then start the next one.",
        startLabel: "Coin of the Week",
        namePlaceholder: "e.g. 1893-S Morgan Silver Dollar",
      }}
    />
  );
}
