import { NextResponse } from "next/server";
import { getCallbackAlerts } from "@/lib/followup/queue";

export const dynamic = "force-dynamic";

/** Polled by the in-app CallbackAlerts banner. Auth is enforced by the proxy for every route. */
export async function GET() {
  const alerts = await getCallbackAlerts(new Date());
  return NextResponse.json({ now: new Date().toISOString(), alerts });
}
