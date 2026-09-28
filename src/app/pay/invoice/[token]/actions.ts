"use server";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { UserError } from "@/lib/actions";
import { balanceOf } from "@/lib/money/service";
import { createPaymentLink } from "@/lib/payments/links";
import { readPayToken } from "@/lib/payments/tokens";

export type StartState = { error?: string } | undefined;

/** Customer taps "Pay by card": make (or reuse) a Stripe Checkout link for the current balance and go there. */
export async function startCheckout(token: string, _prev: StartState): Promise<StartState> {
  const t = readPayToken(token, "invoice");
  if (!t) return { error: "This payment link isn't valid." };
  let url: string;
  try {
    const [inv] = await db.select().from(invoices).where(and(eq(invoices.tenantId, t.tenantId), eq(invoices.id, t.id)));
    if (!inv) return { error: "This payment link isn't valid." };
    const link = await createPaymentLink(t.tenantId, inv.id, balanceOf(inv), null, { returnTo: "invoice" });
    url = link.url;
  } catch (e) {
    if (e instanceof UserError) {
      // Staff-facing wording (Stripe errors, setup hints) isn't for customers.
      if (/Stripe|terminal|Settings/.test(e.message)) return { error: "Online card payments aren't available right now. Please try again in a few minutes, or contact the shop to pay." };
      return { error: e.message };
    }
    console.error("[pay invoice]", e);
    return { error: "Something went wrong. Please try again in a minute." };
  }
  redirect(url);
}
