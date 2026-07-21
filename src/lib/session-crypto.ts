// JWT sign/verify only — no next/headers imports, so the proxy (edge runtime) can use it too.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "prc_session";
export const SESSION_DAYS = 30;

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function encryptSession(payload: { user: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

/** Returns the session payload, or null for a missing/invalid/expired token. */
export async function verifySessionToken(token: string | undefined): Promise<{ user: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return typeof payload.user === "string" ? { user: payload.user } : null;
  } catch {
    return null;
  }
}
