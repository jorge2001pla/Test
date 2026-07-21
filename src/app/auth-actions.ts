"use server";

import { timingSafeEqual, createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { createSession, deleteSession } from "@/lib/session";

/** Constant-time comparison over fixed-length digests, so mismatched input lengths and early
 * bytes leak nothing about the stored credential. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function loginAction(formData: FormData): Promise<void> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const expectedUser = process.env.AUTH_USERNAME;
  const expectedPassword = process.env.AUTH_PASSWORD;
  if (!expectedUser || !expectedPassword) {
    throw new Error("Auth credentials are not configured on the server.");
  }

  const ok = safeEqual(username.toLowerCase(), expectedUser.toLowerCase()) && safeEqual(password, expectedPassword);
  if (!ok) {
    // Small fixed delay to blunt brute-force attempts.
    await new Promise((r) => setTimeout(r, 1500));
    redirect("/login?error=1");
  }

  await createSession(username.toLowerCase());
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await deleteSession();
  redirect("/login");
}
