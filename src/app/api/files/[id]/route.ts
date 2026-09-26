import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getFileRow } from "@/lib/files";
import { storage } from "@/lib/storage";

const INLINE = /^(image\/(png|jpeg|gif|webp|svg\+xml)|application\/pdf)$/;

/** Authenticated file download. ?download=1 forces a download. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const row = await getFileRow(user.tenantId, Number(id));
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ok =
    row.folder === "receipt" ? can(user.role, "expenses.edit") || can(user.role, "money.view") :
    row.jobId ? can(user.role, "jobs.view") :
    row.customerId ? can(user.role, "customers.view") :
    row.quoteId ? can(user.role, "quotes.view") : can(user.role, "settings.manage");
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let data: Buffer;
  try {
    data = await storage().get(row.storageKey);
  } catch {
    return NextResponse.json({ error: "File is missing from storage" }, { status: 404 });
  }
  const download = new URL(req.url).searchParams.has("download") || !INLINE.test(row.mimeType);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Length": String(data.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      "Cache-Control": "private, max-age=3600",
      // SVGs can contain scripts — sandbox anything we render inline.
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
