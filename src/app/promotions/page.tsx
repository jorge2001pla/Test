import { redirect } from "next/navigation";

// Promotions and Coin of the Week retired from the app (hidden; data kept).
export default function PromotionsRedirect() {
  redirect("/");
}
