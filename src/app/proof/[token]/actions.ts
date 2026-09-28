"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { proofByToken, proofLinkTenant } from "@/lib/proofs";
import { getSettings } from "@/lib/settings";
import { recordProofResponse } from "@/lib/proofs-respond";
import { shopName } from "./statement";

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

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  const ua = h.get("user-agent")?.slice(0, 300) ?? null;
  // The link decides the shop; everything in recordProofResponse stays inside it.
  const answered = await recordProofResponse({
    tenantId: row.proof.tenantId,
    proof: { id: row.proof.id, version: row.proof.version },
    job: row.job,
    decision,
    name: base.data.name,
    email: base.data.email || null,
    comment,
    ip,
    userAgent: ua,
    via: "link",
  });
  if (!answered) return { error: "This proof has already been answered or replaced." };
  revalidatePath(`/jobs/${row.job.number}`);
  return { ok: true };
}
