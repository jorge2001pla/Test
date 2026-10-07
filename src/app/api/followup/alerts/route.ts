import { NextResponse } from "next/server";
import { getAlerts } from "@/lib/followup/alerts";

export const dynamic = "force-dynamic";

/** Polled by the in-app alerts banner. Auth is enforced by the proxy for every route. */
export async function GET() {
  const alerts = await getAlerts(new Date());
  return NextResponse.json({ now: new Date().toISOString(), alerts });
}
