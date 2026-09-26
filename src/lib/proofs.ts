import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, files, jobs, proofs } from "@/lib/db/schema";

export const hashProofToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Look up a proof by its secure link token. Returns null if unknown or expired. */
export async function proofByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) return null;
  const [row] = await db
    .select({ proof: proofs, job: { id: jobs.id, number: jobs.number, title: jobs.title, customerId: jobs.customerId, designerId: jobs.designerId, salespersonId: jobs.salespersonId }, customer: customers.name, file: { id: files.id, mimeType: files.mimeType, filename: files.filename, storageKey: files.storageKey } })
    .from(proofs)
    .innerJoin(jobs, eq(jobs.id, proofs.jobId))
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .innerJoin(files, eq(files.id, proofs.fileId))
    .where(and(eq(proofs.tokenHash, hashProofToken(token)), gt(proofs.tokenExpiresAt, new Date())));
  return row ?? null;
}
