import "server-only";
import { and, eq, isNull, max } from "drizzle-orm";
import { db } from "@/lib/db";
import { files, jobs, proofs, type FileFolder } from "@/lib/db/schema";
import { basicPreflight, MAX_UPLOAD_BYTES, newStorageKey, storage } from "@/lib/storage";
import { logActivity } from "@/lib/activity";
import { notify } from "@/lib/notifications";
import { changeJobStatus } from "@/lib/jobs/service";
import { nextStatus } from "@/lib/jobs/workflow";
import { jobNo } from "@/lib/format";
import type { SessionUser } from "@/lib/auth";

export const FOLDER_LABELS: Record<FileFolder, string> = {
  customer: "Customer Files",
  original_artwork: "Original Artwork",
  working: "Working Files",
  proof: "Proofs",
  production: "Production Files",
  install_photos: "Installation Photos",
  completed_photos: "Completed Photos",
  receipt: "Receipts",
  other: "Other",
};
export const JOB_FOLDERS: FileFolder[] = ["original_artwork", "customer", "working", "proof", "production", "install_photos", "completed_photos"];

const BLOCKED_EXT = /\.(exe|bat|cmd|com|msi|sh|ps1|js|mjs|jar|app|dll|scr|vbs|html?)$/i;

export async function saveUpload(
  file: File,
  opts: { folder: FileFolder; jobId?: number | null; customerId?: number | null; quoteId?: number | null; note?: string | null },
  user: SessionUser,
) {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is larger than 50 MB.`);
  if (BLOCKED_EXT.test(file.name)) throw new Error(`${file.name}: this file type isn't allowed.`);
  const filename = file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 200) || "file";
  const key = newStorageKey(filename);
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  await storage().put(key, buf, mime);
  const pf = basicPreflight(filename, mime, file.size);

  let job: typeof jobs.$inferSelect | undefined;
  if (opts.jobId) [job] = await db.select().from(jobs).where(eq(jobs.id, opts.jobId));

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(files)
      .values({
        jobId: opts.jobId ?? null,
        customerId: opts.customerId ?? job?.customerId ?? null,
        quoteId: opts.quoteId ?? null,
        folder: opts.folder,
        filename,
        storageKey: key,
        mimeType: mime,
        sizeBytes: file.size,
        preflightStatus: ["original_artwork", "customer", "production"].includes(opts.folder) ? pf.status : null,
        preflight: { notes: pf.notes },
        uploadedBy: user.id,
      })
      .returning();

    if (job) {
      const actor = { id: user.id, name: user.name };
      if (opts.folder === "proof") {
        // Never overwrite proofs: each upload is a new version.
        const [{ v }] = await tx.select({ v: max(proofs.version) }).from(proofs).where(eq(proofs.jobId, job.id));
        const version = (v ?? 0) + 1;
        await tx.update(proofs).set({ status: "superseded" }).where(and(eq(proofs.jobId, job.id), eq(proofs.status, "draft")));
        await tx.insert(proofs).values({ jobId: job.id, version, fileId: row!.id, status: "draft", note: opts.note ?? null, createdBy: user.id });
        await tx.update(files).set({ filename: `Proof V${version} — ${filename}` }).where(eq(files.id, row!.id));
        await logActivity({ action: "proof.uploaded", entityType: "proof", jobId: job.id, customerId: job.customerId, actorId: user.id, summary: `Uploaded Proof V${version}` }, tx);
        if (["approved", "waiting_artwork", "design", "waiting_approval", "proof_ready"].includes(job.status))
          await changeJobStatus(tx, job, "proof_ready", actor, { reason: `Proof V${version} uploaded` });
      } else {
        await logActivity({ action: "file.uploaded", entityType: "file", entityId: row!.id, jobId: job.id, customerId: job.customerId, actorId: user.id, summary: `Uploaded ${filename} to ${FOLDER_LABELS[opts.folder]}` }, tx);
        if (opts.folder === "original_artwork" || opts.folder === "customer") {
          if (job.status === "waiting_artwork") {
            const next = nextStatus(job);
            if (next) await changeJobStatus(tx, job, next, actor, { reason: "Artwork received" });
          }
          await notify({ userIds: [job.designerId, job.salespersonId], kind: "artwork", title: `Artwork uploaded to ${jobNo(job.number)}`, body: filename, link: `/jobs/${job.number}?tab=files`, actorId: user.id }, tx);
        }
      }
    }
    return row!;
  });
}

export async function getFileRow(id: number) {
  const [row] = await db.select().from(files).where(and(eq(files.id, id), isNull(files.archivedAt)));
  return row;
}
