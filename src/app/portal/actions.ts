"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoices, jobs, proofs } from "@/lib/db/schema";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { balanceOf } from "@/lib/money/service";
import { createPaymentLink } from "@/lib/payments/links";
import { stripeConnected } from "@/lib/payments/connection";
import { recordProofResponse } from "@/lib/proofs-respond";
import { portalLinkRateLimited, sendSignInLinks } from "@/lib/portal/links";
import { assertSameOrigin, portalClientIp, portalUserAgent, requirePortalAction } from "@/lib/portal/session";
import { acceptQuoteOnline, createPortalRequest, declineQuoteOnline } from "@/lib/portal/service";
import { getPortalSettings, requirePortalFeature } from "@/lib/portal/settings";
import { portalAllows, REQUEST_FEATURE } from "@/lib/portal/config";
import { AcceptQuoteInput, DeclineQuoteInput, PORTAL_INVOICE_STATUSES, PortalRequestInput, SignInEmail } from "@/lib/portal/rules";

/**
 * Customer portal Server Actions. Each one checks the request came from our own pages (same origin)
 * and scopes everything to the signed-in customer's shop and account.
 */

export type SignInState = { sent?: boolean; error?: string } | undefined;

/** "Email me a sign-in link". Always the same answer, so it can't be used to find out who's a customer. */
export async function requestSignInLink(_prev: SignInState, fd: FormData): Promise<SignInState> {
  try {
    await assertSameOrigin();
  } catch {
    return { error: "Please reload the page and try again." };
  }
  const parsed = SignInEmail.safeParse(fd.get("email") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const email = parsed.data;
  const ip = (await portalClientIp()) ?? "unknown";
  if (await portalLinkRateLimited(email, ip)) return { sent: true };
  // Send after the response, so how long it takes doesn't give away whether the email is on file.
  after(async () => {
    try {
      await sendSignInLinks(email);
    } catch (e) {
      console.error("[portal sign-in link]", e);
    }
  });
  return { sent: true };
}

export async function acceptQuote(quoteId: number, input: { name: string; agree: boolean; note: string; quantities: Record<string, number> }): Promise<ActionResult> {
  return runAction(async () => {
    const s = await requirePortalAction();
    await requirePortalFeature(s.tenantId, "quotes");
    const data = AcceptQuoteInput.parse(input);
    await acceptQuoteOnline(s, Number(quoteId), data, { ip: await portalClientIp(), userAgent: await portalUserAgent() });
    revalidatePath("/portal", "layout");
  }, "Thank you — your quote is accepted.");
}

export async function declineQuote(quoteId: number, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const s = await requirePortalAction();
    await requirePortalFeature(s.tenantId, "quotes");
    const data = DeclineQuoteInput.parse({ reason });
    await declineQuoteOnline(s, Number(quoteId), data.reason, { ip: await portalClientIp(), userAgent: await portalUserAgent() });
    revalidatePath("/portal", "layout");
  }, "Thanks for letting us know.");
}

/** Approve a proof / ask for changes from the portal: the same audited path as the emailed proof link. */
export async function respondToProofInPortal(proofId: number, input: { decision: "approve" | "changes"; name: string; comment: string; agree: boolean }): Promise<ActionResult> {
  return runAction(async () => {
    const s = await requirePortalAction();
    const name = String(input.name ?? "").trim().slice(0, 120);
    const comment = String(input.comment ?? "").trim().slice(0, 4000);
    if (name.length < 2) throw new UserError("Please enter your name.");
    if (input.decision !== "approve" && input.decision !== "changes") throw new UserError("Choose approve or request changes.");
    if (input.decision === "approve" && input.agree !== true) throw new UserError("Please check the approval box.");
    if (input.decision === "changes" && comment.length < 3) throw new UserError("Please tell us what to change.");
    const [row] = await db
      .select({ proof: { id: proofs.id, version: proofs.version, status: proofs.status }, job: { id: jobs.id, number: jobs.number, title: jobs.title, customerId: jobs.customerId, designerId: jobs.designerId, salespersonId: jobs.salespersonId } })
      .from(proofs)
      .innerJoin(jobs, and(eq(jobs.tenantId, proofs.tenantId), eq(jobs.id, proofs.jobId)))
      .where(and(eq(proofs.tenantId, s.tenantId), eq(proofs.id, Number(proofId)), eq(jobs.customerId, s.customerId)));
    if (!row) throw new UserError("Proof not found.");
    if (row.proof.status !== "sent") throw new UserError("This proof has already been answered or replaced.");
    const ok = await recordProofResponse({
      tenantId: s.tenantId,
      proof: row.proof,
      job: row.job,
      decision: input.decision,
      name,
      email: s.email,
      comment,
      ip: await portalClientIp(),
      userAgent: await portalUserAgent(),
      via: "portal",
    });
    if (!ok) throw new UserError("This proof has already been answered or replaced.");
    revalidatePath("/portal", "layout");
    revalidatePath(`/jobs/${row.job.number}`);
  }, input.decision === "approve" ? "Thank you — your proof is approved." : "Thank you — we got your changes.");
}

/** Reorder / request a quote / message the shop. */
export async function sendPortalRequest(input: unknown): Promise<ActionResult<{ id: number }>> {
  return runAction(async () => {
    const s = await requirePortalAction();
    const data = PortalRequestInput.parse(input);
    await requirePortalFeature(s.tenantId, REQUEST_FEATURE[data.kind]);
    if (data.fileIds.length) await requirePortalFeature(s.tenantId, "uploads");
    const r = await createPortalRequest(s, data);
    revalidatePath("/portal", "layout");
    revalidatePath("/requests");
    return r;
  }, "Sent — we'll be in touch soon.");
}

export type PayState = { error?: string } | undefined;

/** "Pay online": a Stripe Checkout link for the invoice's balance (when the shop has Stripe connected). */
export async function payInvoiceOnline(invoiceId: number, _prev: PayState): Promise<PayState> {
  let url: string;
  try {
    const s = await requirePortalAction();
    if (!portalAllows(await getPortalSettings(s.tenantId), "pay")) return { error: "Online payments aren't available. Please call us to pay." };
    const [inv] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, s.tenantId), eq(invoices.customerId, s.customerId), eq(invoices.id, Number(invoiceId)), inArray(invoices.status, PORTAL_INVOICE_STATUSES)));
    if (!inv) return { error: "Invoice not found." };
    if (!(await stripeConnected(s.tenantId))) return { error: "Online card payments aren't available. Please call us to pay." };
    const link = await createPaymentLink(s.tenantId, inv.id, balanceOf(inv), null, { returnTo: "invoice" });
    url = link.url;
  } catch (e) {
    if (e instanceof UserError) {
      // Staff-facing wording (Stripe errors, setup hints) isn't for customers.
      if (/Stripe|terminal|Settings/.test(e.message)) return { error: "Online card payments aren't available right now. Please try again in a few minutes, or call us to pay." };
      return { error: e.message };
    }
    console.error("[portal pay]", e);
    return { error: "Something went wrong. Please try again in a minute." };
  }
  redirect(url);
}
