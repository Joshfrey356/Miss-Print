"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { communications, jobs, proofs } from "@/lib/db/schema";
import { proofByToken, proofLinkTenant } from "@/lib/proofs";
import { logActivity } from "@/lib/activity";
import { notify } from "@/lib/notifications";
import { changeJobStatus } from "@/lib/jobs/service";
import { jobNo } from "@/lib/format";
import { getJobPrefix } from "@/lib/tenant";
import { getSettings } from "@/lib/settings";
import { approvalStatement, shopName } from "./statement";

export type ProofResponseState = { ok?: boolean; error?: string } | undefined;

const Base = z.object({
  name: z.string().trim().min(2, "Please enter your name.").max(120),
  email: z.string().trim().email("Please enter a valid email.").max(200).or(z.literal("")),
});

/** Customer response from the public proof link. No account; audited with name, email, time, IP and browser. */
export async function respondToProof(token: string, _prev: ProofResponseState, fd: FormData): Promise<ProofResponseState> {
  const decision = fd.get("decision");
  const base = Base.safeParse({ name: fd.get("name") ?? "", email: fd.get("email") ?? "" });
  if (!base.success) return { error: base.error.issues[0]!.message };
  const comment = String(fd.get("comment") ?? "").trim().slice(0, 4000);
  if (decision === "approve" && fd.get("agree") !== "on") return { error: "Please check the approval box." };
  if (decision === "changes" && comment.length < 3) return { error: "Please tell us what to change." };
  if (decision !== "approve" && decision !== "changes") return { error: "Choose approve or request changes." };

  const row = await proofByToken(token);
  if (!row) {
    const linkTenant = await proofLinkTenant(token);
    const name = linkTenant ? (await getSettings(linkTenant)).company.name : null;
    return { error: `This link has expired. Please contact ${shopName(name)}.` };
  }
  if (row.proof.status !== "sent") return { error: "This proof has already been answered or replaced." };
  // The link decides the shop; everything below stays inside it.
  const tenantId = row.proof.tenantId;
  const { company } = await getSettings(tenantId);
  const statement = approvalStatement(shopName(company.name));

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  const ua = h.get("user-agent")?.slice(0, 300) ?? null;
  const approved = decision === "approve";
  const who = base.data.name;

  const answered = await db.transaction(async (tx) => {
    // Only a still-"sent" proof can be answered; guards against double submits / replays racing the check above.
    const [updated] = await tx
      .update(proofs)
      .set({
        status: approved ? "approved" : "changes_requested",
        respondedAt: new Date(),
        responderName: who,
        responderEmail: base.data.email || null,
        responderIp: ip,
        responderUserAgent: ua,
        customerComment: comment || null,
        approvalStatement: approved ? statement : null,
      })
      .where(and(eq(proofs.tenantId, tenantId), eq(proofs.id, row.proof.id), eq(proofs.status, "sent")))
      .returning({ id: proofs.id });
    if (!updated) return false;
    await tx.insert(communications).values({
      tenantId,
      customerId: row.job.customerId,
      jobId: row.job.id,
      channel: "email",
      direction: "inbound",
      template: approved ? "proof_approved" : "proof_changes",
      toAddress: base.data.email || null,
      subject: `${approved ? "Approved" : "Changes requested"}: Proof V${row.proof.version}`,
      body: comment || (approved ? statement : null),
      status: "logged",
    });
    await logActivity(
      {
        tenantId,
        action: approved ? "proof.approved" : "proof.changes_requested",
        entityType: "proof",
        entityId: row.proof.id,
        jobId: row.job.id,
        customerId: row.job.customerId,
        actorId: null,
        summary: approved ? `Customer ${who} approved Proof V${row.proof.version}` : `Customer ${who} requested changes to Proof V${row.proof.version}: “${comment.slice(0, 140)}”`,
        data: { ip, userAgent: ua, email: base.data.email || null },
      },
      tx,
    );
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, row.job.id)));
    if (job) {
      if (approved && ["proof_ready", "waiting_approval", "design"].includes(job.status))
        await changeJobStatus(tx, job, "approved_for_production", null, { reason: `customer approved Proof V${row.proof.version}` });
      if (!approved && ["proof_ready", "waiting_approval"].includes(job.status)) await changeJobStatus(tx, job, "design", null, { reason: "customer requested changes" });
    }
    const prefix = await getJobPrefix(tenantId);
    await notify(
      {
        tenantId,
        userIds: [row.job.designerId, row.job.salespersonId],
        kind: "proof",
        title: approved ? `Customer approved Proof V${row.proof.version} — ${jobNo(row.job.number, prefix)}` : `Changes requested on ${jobNo(row.job.number, prefix)}`,
        body: approved ? `${who} approved “${row.job.title}”.` : `${who}: ${comment.slice(0, 200)}`,
        link: `/jobs/${row.job.number}?tab=files`,
      },
      tx,
    );
    return true;
  });
  if (!answered) return { error: "This proof has already been answered or replaced." };
  revalidatePath(`/jobs/${row.job.number}`);
  return { ok: true };
}
