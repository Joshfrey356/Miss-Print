import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal/session";
import { portalFile } from "@/lib/portal/queries";
import { storage } from "@/lib/storage";

const INLINE = /^(image\/(png|jpeg|gif|webp|svg\+xml)|application\/pdf)$/;

/** A file for the signed-in customer: one they uploaded, or a proof sent to them. ?download=1 forces a download. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getPortalSession();
  if (!s) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const row = /^\d{1,10}$/.test(id) ? await portalFile(s, Number(id)) : null;
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let data: Buffer;
  try {
    data = await storage().get(row.storageKey);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const download = new URL(req.url).searchParams.has("download") || !INLINE.test(row.mimeType);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Length": String(data.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      "Cache-Control": "private, no-store",
      // Customer files can be anything (SVGs can contain scripts) — sandbox what we show inline.
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
