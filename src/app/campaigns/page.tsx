import { redirect } from "next/navigation";

// Campaigns / Coin of the Week are switched off in this app (code and data are kept in case they come back).
export default function CampaignsRetired() {
  redirect("/");
}
