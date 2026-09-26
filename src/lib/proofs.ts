import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, files, jobs, proofs } from "@/lib/db/schema";

export const hashProofToken = (t: string) => createHash("sha256").update(t).digest("hex");

const validToken = (t: string) => /^[A-Za-z0-9_-]{30,80}$/.test(t);

/**
 * Look up a proof by its secure link token. Returns null if unknown or expired.
 * The token is the only key a customer has: it decides the shop (`proof.tenantId`), and
 * everything else on the public proof page must be scoped by that.
 */
export async function proofByToken(token: string) {
  if (!validToken(token)) return null;
  // tenant-scope: found by its globally unique token hash; the joins stay inside the proof's own shop.
  const [row] = await db
    .select({ proof: proofs, job: { id: jobs.id, number: jobs.number, title: jobs.title, customerId: jobs.customerId, designerId: jobs.designerId, salespersonId: jobs.salespersonId }, customer: customers.name, file: { id: files.id, mimeType: files.mimeType, filename: files.filename, storageKey: files.storageKey } })
    .from(proofs)
    .innerJoin(jobs, and(eq(jobs.tenantId, proofs.tenantId), eq(jobs.id, proofs.jobId)))
    .innerJoin(customers, and(eq(customers.tenantId, jobs.tenantId), eq(customers.id, jobs.customerId)))
    .innerJoin(files, and(eq(files.tenantId, proofs.tenantId), eq(files.id, proofs.fileId)))
    .where(and(eq(proofs.tokenHash, hashProofToken(token)), gt(proofs.tokenExpiresAt, new Date())));
  return row ?? null;
}

/** The shop a proof link belongs to, even after it expired (so the "expired" page shows that shop). */
export async function proofLinkTenant(token: string): Promise<number | null> {
  if (!validToken(token)) return null;
  // tenant-scope: found by its globally unique token hash.
  const [row] = await db.select({ tenantId: proofs.tenantId }).from(proofs).where(eq(proofs.tokenHash, hashProofToken(token)));
  return row?.tenantId ?? null;
}
