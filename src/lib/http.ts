import "server-only";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

/**
 * CSRF defense for JSON/multipart route handlers (Server Actions already check this).
 * Session cookies are SameSite=Lax, and we additionally require the Origin to match Host.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.method === "GET";
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const forbidden = (msg = "Forbidden") => NextResponse.json({ error: msg }, { status: 403 });

/**
 * Public base URL for links in emails (proofs, invites, password resets).
 * APP_URL when set; otherwise the Vercel production domain; otherwise the current request's host.
 */
export async function appUrl() {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : "http://localhost:3000";
}
