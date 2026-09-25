import "server-only";
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
