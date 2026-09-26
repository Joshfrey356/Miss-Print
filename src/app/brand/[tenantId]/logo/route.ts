import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { storage } from "@/lib/storage";

/**
 * A shop's logo (white-label). Public on purpose: it appears on the sign-in page and on
 * customer proof pages, where nobody is signed in. Only ever serves the logo itself.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  const id = Number(tenantId);
  const tenant = Number.isInteger(id) && id > 0 ? await getTenant(id) : undefined;
  if (!tenant?.logoStorageKey || !tenant.logoMimeType || tenant.archivedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let data: Buffer;
  try {
    data = await storage().get(tenant.logoStorageKey);
  } catch {
    return NextResponse.json({ error: "Logo is missing from storage" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": tenant.logoMimeType,
      "Content-Length": String(data.length),
      // URLs carry ?v=<upload time>, so a new logo gets a new URL.
      "Cache-Control": "public, max-age=86400",
      // SVGs can contain scripts — sandbox it in case someone opens the URL directly.
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
