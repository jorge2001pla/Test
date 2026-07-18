import { redirect } from "next/navigation";

// Promotions and Coin of the Week merged into a single Campaigns page.
export default function PromotionsRedirect() {
  redirect("/campaigns");
}
