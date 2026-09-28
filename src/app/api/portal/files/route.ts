import { NextResponse } from "next/server";
import { forbidden, sameOrigin } from "@/lib/http";
import { UserError } from "@/lib/actions";
import { getPortalSession } from "@/lib/portal/session";
import { getPortalSettings } from "@/lib/portal/settings";
import { portalAllows } from "@/lib/portal/config";
import { MAX_PORTAL_FILES, savePortalUpload } from "@/lib/portal/service";

/**
 * Customer artwork upload (multipart/form-data: files[], jobId?). Portal session only; files land in
 * the job's Customer Files, or on the customer (for a reorder / quote request) when there's no jobId.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const s = await getPortalSession();
  if (!s) return NextResponse.json({ error: "You've been signed out. Please sign in again." }, { status: 401 });
  if (!portalAllows(await getPortalSettings(s.tenantId), "uploads")) return NextResponse.json({ error: "Uploading files isn't available. Please email them to us instead." }, { status: 403 });
  const fd = await req.formData();
  const jobId = fd.get("jobId") ? Number(fd.get("jobId")) : null;
  if (jobId !== null && !(Number.isInteger(jobId) && jobId > 0)) return NextResponse.json({ error: "Order not found." }, { status: 400 });
  const list = fd.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f);
  if (!list.length) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  if (list.length > MAX_PORTAL_FILES) return NextResponse.json({ error: `Up to ${MAX_PORTAL_FILES} files at a time, please.` }, { status: 400 });
  const saved: { id: number; filename: string }[] = [];
  try {
    for (const f of list) saved.push(await savePortalUpload(f, s, { jobId }));
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message, files: saved }, { status: 400 });
    console.error("[portal upload]", e);
    return NextResponse.json({ error: "Upload failed. Please try again.", files: saved }, { status: 500 });
  }
  return NextResponse.json({ files: saved });
}
