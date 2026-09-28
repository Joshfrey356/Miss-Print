import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { communications, jobs, proofs } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { notify } from "@/lib/notifications";
import { changeJobStatus } from "@/lib/jobs/service";
import { jobNo } from "@/lib/format";
import { getJobPrefix } from "@/lib/tenant";
import { getSettings } from "@/lib/settings";
import { approvalStatement, shopName } from "@/app/proof/[token]/statement";

export type ProofDecision = "approve" | "changes";

export type ProofResponseInput = {
  tenantId: number;
  proof: { id: number; version: number };
  job: { id: number; number: number; title: string; customerId: number; designerId: number | null; salespersonId: number | null };
  decision: ProofDecision;
  /** Who answered, as typed (proof link) or from the portal sign-in. */
  name: string;
  email: string | null;
  comment: string;
  ip: string | null;
  userAgent: string | null;
  /** "link" = the emailed proof link; "portal" = the signed-in customer portal. */
  via: "link" | "portal";
};

/**
 * Record a customer's answer to a sent proof — the one place both the public proof link and the customer
 * portal go through. Only a still-"sent" proof can be answered (guards double submits and replays).
 * Audits name, email, time, IP and browser; moves the job on (approved → production, changes → design)
 * with changeJobStatus(); tells the designer and salesperson. Returns false if it was already answered.
 */
export async function recordProofResponse(input: ProofResponseInput): Promise<boolean> {
  const { tenantId, proof, job: j, name: who, email, comment, ip, userAgent: ua } = input;
  const approved = input.decision === "approve";
  const { company } = await getSettings(tenantId);
  const statement = approvalStatement(shopName(company.name));
  const portal = input.via === "portal";

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(proofs)
      .set({
        status: approved ? "approved" : "changes_requested",
        respondedAt: new Date(),
        responderName: who,
        responderEmail: email || null,
        responderIp: ip,
        responderUserAgent: ua,
        customerComment: comment || null,
        approvalStatement: approved ? statement : null,
      })
      .where(and(eq(proofs.tenantId, tenantId), eq(proofs.id, proof.id), eq(proofs.status, "sent")))
      .returning({ id: proofs.id });
    if (!updated) return false;
    await tx.insert(communications).values({
      tenantId,
      customerId: j.customerId,
      jobId: j.id,
      channel: "email",
      direction: "inbound",
      template: approved ? "proof_approved" : "proof_changes",
      toAddress: email || null,
      subject: `${approved ? "Approved" : "Changes requested"}: Proof V${proof.version}${portal ? " (customer portal)" : ""}`,
      body: comment || (approved ? statement : null),
      status: "logged",
    });
    await logActivity(
      {
        tenantId,
        action: approved ? "proof.approved" : "proof.changes_requested",
        entityType: "proof",
        entityId: proof.id,
        jobId: j.id,
        customerId: j.customerId,
        actorId: null,
        summary: approved
          ? `Customer ${who} approved Proof V${proof.version}${portal ? " in the customer portal" : ""}`
          : `Customer ${who} requested changes to Proof V${proof.version}${portal ? " in the customer portal" : ""}: “${comment.slice(0, 140)}”`,
        data: portal ? { ip, userAgent: ua, email: email || null, via: "portal" } : { ip, userAgent: ua, email: email || null },
      },
      tx,
    );
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, j.id)));
    if (job) {
      if (approved && ["proof_ready", "waiting_approval", "design"].includes(job.status))
        await changeJobStatus(tx, job, "approved_for_production", null, { reason: `customer approved Proof V${proof.version}` });
      if (!approved && ["proof_ready", "waiting_approval"].includes(job.status)) await changeJobStatus(tx, job, "design", null, { reason: "customer requested changes" });
    }
    const prefix = await getJobPrefix(tenantId);
    await notify(
      {
        tenantId,
        userIds: [j.designerId, j.salespersonId],
        kind: "proof",
        title: approved ? `Customer approved Proof V${proof.version} — ${jobNo(j.number, prefix)}` : `Changes requested on ${jobNo(j.number, prefix)}`,
        body: approved ? `${who} approved “${j.title}”.` : `${who}: ${comment.slice(0, 200)}`,
        link: `/jobs/${j.number}?tab=files`,
      },
      tx,
    );
    return true;
  });
}
