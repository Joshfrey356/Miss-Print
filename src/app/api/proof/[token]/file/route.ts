import { NextResponse } from "next/server";
import { proofByToken } from "@/lib/proofs";
import { storage } from "@/lib/storage";

/** Public (token-protected) proof image/PDF for the customer approval page. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const row = await proofByToken(token);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = await storage().get(row.file.storageKey).catch(() => null);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": row.file.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.file.filename)}`,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
