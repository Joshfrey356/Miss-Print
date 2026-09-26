import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fileFolderEnum, type FileFolder } from "@/lib/db/schema";
import { forbidden, sameOrigin } from "@/lib/http";
import { saveUpload } from "@/lib/files";

/** Upload one or more files (multipart/form-data: files[], folder, jobId?, customerId?, quoteId?, note?) */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const fd = await req.formData();
  const folder = String(fd.get("folder") ?? "other") as FileFolder;
  if (!fileFolderEnum.enumValues.includes(folder)) return NextResponse.json({ error: "Unknown folder" }, { status: 400 });
  const allowed = folder === "receipt" ? can(user.role, "expenses.edit") : folder === "proof" ? can(user.role, "proofs.send") : can(user.role, "files.upload");
  if (!allowed) return forbidden("You don't have permission to upload here.");
  const id = (k: string) => (fd.get(k) ? Number(fd.get(k)) || null : null);
  const list = fd.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f);
  if (!list.length) return NextResponse.json({ error: "No files" }, { status: 400 });
  const saved = [];
  try {
    for (const f of list)
      saved.push(await saveUpload(f, { folder, jobId: id("jobId"), customerId: id("customerId"), quoteId: id("quoteId"), note: (fd.get("note") as string) || null }, user));
  } catch (e) {
    // Our own validation messages are safe to show; anything else (e.g. a database error) is not.
    const msg = e instanceof Error && /larger than|isn't allowed/.test(e.message) ? e.message : "Upload failed. Please try again.";
    if (msg.startsWith("Upload failed")) console.error("[upload error]", e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ files: saved.map((f) => ({ id: f.id, filename: f.filename })) });
}
