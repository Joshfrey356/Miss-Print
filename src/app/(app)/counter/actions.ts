"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, requirePermission, requireUser, type SessionUser } from "@/lib/auth";
import { runAction, str, UserError, type ActionResult } from "@/lib/actions";
import { can } from "@/lib/permissions";
import { parseMoney, today } from "@/lib/format";
import { priceCounterItem } from "@/lib/counter/pricing";
import { shortProduction } from "@/lib/counter/print";
import { getCategories, getLocations } from "@/lib/lookups";
import { cancelCounterSale, closeRegister, createCounterSale, emailReceipt, invoiceForJob, invoiceForQuote, takeCounterPayment } from "@/lib/counter/service";
import { cancelPaymentLink, checkPaymentLink, createPaymentLink, emailPayLink, qrDataUrl } from "@/lib/payments/links";

const actor = (u: SessionUser) => ({ id: u.id, name: u.name, tenantId: u.tenantId, locationId: u.locationId });
const id = z.number().int().positive();
const cents = (label: string) => z.number({ error: `Enter the ${label}.` }).int().min(0, `The ${label} can't be negative.`).max(100_000_000, `The ${label} looks too large.`);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.");

function revalidateCounter() {
  revalidatePath("/counter", "layout");
  revalidatePath("/money", "layout");
  revalidatePath("/jobs", "layout");
  revalidatePath("/customers", "layout");
  revalidatePath("/dashboard");
}

/** Counter screens, or the invoice page for people who handle money. */
async function requireCounterOrMoney() {
  const user = await requireUser();
  if (!can(user.role, "counter.use") && !can(user.role, "money.edit")) throw new ForbiddenError();
  return user;
}

// ---------------------------------------------------------------------------
// Pricing a line (the shop's own price lists: quantity breaks, per piece, per sq ft)
// ---------------------------------------------------------------------------
const PrintChoice = z.object({ pages: z.union([z.literal(1), z.literal(2)]), paperId: id.nullable() });
const PriceReq = z.object({
  categoryId: id,
  quantity: z.number().int().min(1).max(10_000_000),
  widthIn: z.number().positive().max(10_000).nullable().optional(),
  heightIn: z.number().positive().max(10_000).nullable().optional(),
  customerId: id.nullable().optional(),
  print: PrintChoice.nullable().optional(),
});

export type LinePrice = {
  /** Null when no price could be worked out (e.g. no press can run it): type a price instead. */
  recommendedCents: number | null;
  lines: { label: string; cents: number; detail?: string }[];
  warnings: string[];
  /** Print categories: "21 up · 59 sheets · Konica C4080". */
  production: string | null;
};

export async function priceCounterLine(input: z.input<typeof PriceReq>): Promise<ActionResult<LinePrice>> {
  return runAction(async () => {
    const user = await requirePermission("counter.use");
    const req = PriceReq.parse(input);
    const cat = (await getCategories(user.tenantId)).find((c) => c.id === req.categoryId);
    if (!cat) throw new UserError("Category not found.");
    const { result: r, sheetFed } = await priceCounterItem(user.tenantId, { ...req, categoryId: cat.id });
    const warnings = r.warnings.filter((w) => !/margin|cost/i.test(w));
    const failed = sheetFed && !r.production;
    return {
      recommendedCents: failed ? null : r.recommendedCents,
      lines: r.lines,
      warnings: failed && !warnings.length ? ["This can't be estimated with the shop's presses and papers. Type a price."] : warnings,
      production: r.production && can(user.role, "financials.view") ? shortProduction(r.production) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Sale
// ---------------------------------------------------------------------------
const SaleSchema = z.object({
  customerId: id.nullable(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1, "Every item needs a description.").max(500),
        quantity: z.number().int().min(1, "Quantity must be at least 1.").max(10_000_000, "That quantity looks too large."),
        amountCents: cents("price"),
        taxable: z.boolean(),
        categoryId: id.nullable().optional(),
        widthIn: z.number().positive().max(10_000).nullable().optional(),
        heightIn: z.number().positive().max(10_000).nullable().optional(),
        recommendedCents: z.number().int().min(0).nullable().optional(),
        print: PrintChoice.nullable().optional(),
      }),
    )
    .min(1, "Add at least one item to the sale.")
    .max(100),
  poNumber: z.string().max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  production: z.object({ title: z.string().max(200), dueDate: ymd.nullable(), instructions: z.string().max(4000).nullable() }).nullable().optional(),
});
export type SalePayload = z.input<typeof SaleSchema>;

export async function createSaleAction(payload: SalePayload): Promise<ActionResult<{ id: number; number: number; jobNumber: number | null }>> {
  return runAction(async () => {
    const user = await requirePermission("counter.use");
    const input = SaleSchema.parse(payload);
    if (input.production && !can(user.role, "jobs.create")) throw new UserError("You can't create jobs. Ask a manager to add it to the production board.");
    if (input.production?.dueDate && input.production.dueDate < today()) throw new UserError("The due date is in the past.");
    const sale = await createCounterSale(user.tenantId, input, actor(user));
    revalidateCounter();
    return sale;
  });
}

export async function cancelSaleAction(invoiceId: number): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("counter.use");
    await cancelCounterSale(user.tenantId, id.parse(invoiceId), actor(user));
    revalidateCounter();
  }, "Sale cancelled");
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
const PaySchema = z.object({
  method: z.enum(["cash", "check", "card"], { error: "Choose how they're paying." }),
  amountCents: cents("amount").refine((n) => n > 0, "Enter the amount."),
  tenderedCents: cents("cash received").nullable().optional(),
  reference: z.string().trim().max(60).nullable().optional(),
});

export async function takePaymentAction(invoiceId: number, input: z.input<typeof PaySchema>): Promise<ActionResult<{ appliedCents: number; changeCents: number }>> {
  return runAction(async () => {
    const user = await requirePermission("counter.use");
    const p = PaySchema.parse(input);
    if (p.method === "cash" && p.tenderedCents != null && p.tenderedCents <= 0) throw new UserError("Enter the cash received.");
    if (p.method === "check" && !p.reference) throw new UserError("Enter the check number.");
    const r = await takeCounterPayment(user.tenantId, id.parse(invoiceId), p, actor(user));
    revalidateCounter();
    return { appliedCents: r.appliedCents, changeCents: r.changeCents };
  });
}

export type StripeLinkView = { linkId: number; shortUrl: string; url: string; qr: string; amountCents: number };

/** "Card — customer pays on their phone": a Stripe Checkout link + QR code for the amount. */
export async function startStripeAction(invoiceId: number, amountCents: number): Promise<ActionResult<StripeLinkView>> {
  return runAction(async () => {
    const user = await requirePermission("counter.use");
    const link = await createPaymentLink(user.tenantId, id.parse(invoiceId), cents("amount").parse(amountCents), actor(user), { returnTo: "counter" });
    return { linkId: link.id, shortUrl: link.shortUrl, url: link.url, qr: await qrDataUrl(link.shortUrl), amountCents: link.amountCents };
  });
}

export async function checkStripeAction(linkId: number): Promise<ActionResult<{ status: "open" | "paid" | "expired" }>> {
  return runAction(async () => {
    const user = await requirePermission("counter.use");
    const r = await checkPaymentLink(user.tenantId, id.parse(linkId));
    if (r.status === "paid") revalidateCounter();
    return { status: r.status };
  });
}

export async function cancelStripeAction(linkId: number): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("counter.use");
    await cancelPaymentLink(user.tenantId, id.parse(linkId));
  });
}

/** Invoice page / counter: email the customer a "Pay online" link. */
export async function emailPayLinkAction(invoiceId: number, to: string): Promise<ActionResult<{ to: string }>> {
  return runAction(async () => {
    const user = await requireCounterOrMoney();
    const email = z.string().trim().email("Enter a valid email address.").parse(to ?? "");
    const r = await emailPayLink(user.tenantId, id.parse(invoiceId), email, actor(user));
    revalidatePath("/money", "layout");
    return { to: r.to };
  });
}

// ---------------------------------------------------------------------------
// Deposits on jobs / quotes
// ---------------------------------------------------------------------------
export async function depositJobAction(jobId: number): Promise<ActionResult<{ id: number }>> {
  return runAction(async () => {
    const user = await requirePermission("counter.use");
    const inv = await invoiceForJob(user.tenantId, id.parse(jobId), actor(user));
    revalidateCounter();
    return { id: inv.id };
  });
}

export async function depositQuoteAction(quoteId: number): Promise<ActionResult<{ id: number; jobNumber: number }>> {
  return runAction(async () => {
    const user = await requirePermission("counter.use");
    if (!can(user.role, "quotes.edit") || !can(user.role, "jobs.create")) throw new UserError("Turning a quote into a job needs someone who can create jobs.");
    const inv = await invoiceForQuote(user.tenantId, id.parse(quoteId), actor(user));
    revalidateCounter();
    revalidatePath("/quotes", "layout");
    return { id: inv.id, jobNumber: inv.jobNumber };
  });
}

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------
export async function emailReceiptAction(invoiceId: number, to: string): Promise<ActionResult<{ to: string }>> {
  return runAction(async () => {
    const user = await requireCounterOrMoney();
    const email = z.string().trim().email("Enter a valid email address.").parse(to ?? "");
    const r = await emailReceipt(user.tenantId, id.parse(invoiceId), email, actor(user));
    return r;
  });
}

// ---------------------------------------------------------------------------
// End of day
// ---------------------------------------------------------------------------
export async function closeRegisterAction(_prev: unknown, fd: FormData): Promise<ActionResult<{ id: number }>> {
  return runAction(async () => {
    const user = await requirePermission("counter.use");
    const counted = parseMoney(str(fd, "counted"));
    if (counted == null) throw new UserError("Enter the cash you counted in the drawer.");
    const businessDate = ymd.parse(str(fd, "date") ?? today());
    const loc = str(fd, "locationId");
    const locationId = loc ? id.parse(Number(loc)) : null;
    if (locationId && !(await getLocations(user.tenantId)).some((l) => l.id === locationId)) throw new UserError("Location not found.");
    const row = await closeRegister(
      user.tenantId,
      { businessDate, locationId, openingFloatCents: cents("starting cash").parse(parseMoney(str(fd, "float")) ?? 0), countedCashCents: cents("counted cash").parse(counted), notes: str(fd, "notes") },
      actor(user),
    );
    revalidatePath("/counter", "layout");
    return { id: row.id };
  }, "Register closed");
}
