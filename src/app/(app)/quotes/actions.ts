"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { communications, customerContacts, customers, equipment, jobItems, jobs, locations, materials, operations, productCategories, quoteItems, quotes, users } from "@/lib/db/schema";
import { requirePermission } from "@/lib/auth";
import { nextNumber } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { runAction, UserError } from "@/lib/actions";
import { logActivity } from "@/lib/activity";
import { publicResult, type ItemPricingRequest } from "@/lib/pricing/server";
import { priceLine, storedBreakdown } from "@/lib/quotes/pricing";
import { MAX_ALT_QUANTITIES, quantityOptionsText, type QuantityOption, type RunInfo, type StoredBreakdown } from "@/lib/quotes/print-options";
import { findSimilarJobs, type SimilarQuery } from "@/lib/pricing/history";
import { convertQuoteToJob } from "@/lib/jobs/service";
import { getSettings } from "@/lib/settings";
import { addDays, fmtSize, money, quoteNo, today } from "@/lib/format";
import { taxFor, type PricingResult } from "@/lib/pricing/engine";
import { emailProvider } from "@/lib/email";
import { contactForEmail, createPortalLink, portalAccessBlocked, portalLinkUrl } from "@/lib/portal/links";
import { QUOTE_LINK_DAYS } from "@/lib/portal/tokens";
import { getPortalSettings } from "@/lib/portal/settings";

// ---------------------------------------------------------------------------
// Live pricing & history (called while typing in the quote builder)
// ---------------------------------------------------------------------------
/** sheet_fed lines: sides/pages, colors, bleed, paper, press (null = best price) and services. */
const PrintSpec = z.object({
  pages: z.number().int().min(1).max(1000),
  colorsFront: z.number().int().min(0).max(8),
  colorsBack: z.number().int().min(0).max(8),
  bleed: z.boolean(),
  paperId: z.number().int().positive().nullable(),
  pressId: z.number().int().positive().nullable(),
  operationIds: z.array(z.number().int().positive()).max(50),
  servicesChosen: z.boolean().optional(),
});
const AltQuantities = z.array(z.number().int().min(1).max(10_000_000)).max(MAX_ALT_QUANTITIES);

const PricingReq = z.object({
  categoryId: z.number().int().nullable(),
  quantity: z.number().int().min(0).max(10_000_000),
  widthIn: z.number().min(0).max(100_000).nullable().optional(),
  heightIn: z.number().min(0).max(100_000).nullable().optional(),
  materialId: z.number().int().nullable().optional(),
  finishingKeys: z.array(z.string().max(60)).max(30).optional(),
  needsDesign: z.boolean().optional(),
  designHours: z.number().min(0).max(1000).nullable().optional(),
  needsInstall: z.boolean().optional(),
  installHours: z.number().min(0).max(1000).nullable().optional(),
  miles: z.number().min(0).max(10000).nullable().optional(),
  outsourcedCostCents: z.number().int().min(0).nullable().optional(),
  isRush: z.boolean().optional(),
  customBaseCents: z.number().int().min(0).nullable().optional(),
  customerId: z.number().int().nullable().optional(),
  print: PrintSpec.nullable().optional(),
  altQuantities: AltQuantities.optional(),
});

/** Live price of a quote line: the recommendation plus, for print work, how it runs and each press's price. */
export type LinePriceResult = Omit<PricingResult, "production"> & { production: RunInfo | null; quantityOptions: QuantityOption[] };

export async function priceQuoteItem(input: ItemPricingRequest & { altQuantities?: number[] }) {
  return runAction(async (): Promise<LinePriceResult> => {
    const user = await requirePermission("quotes.edit");
    const { altQuantities, ...req } = PricingReq.parse(input);
    const p = await priceLine(user.tenantId, req, altQuantities);
    const pub = publicResult({ ...p.result, pressOptions: p.pressOptions }, can(user.role, "margins.view"));
    return { ...pub, production: p.production, quantityOptions: p.quantityOptions };
  });
}

export async function similarJobs(input: SimilarQuery) {
  return runAction(async () => {
    const user = await requirePermission("quotes.view");
    const q = z
      .object({
        categoryId: z.number().int().nullable().optional(),
        widthIn: z.number().nullable().optional(),
        heightIn: z.number().nullable().optional(),
        quantity: z.number().int().nullable().optional(),
        text: z.string().max(200).nullable().optional(),
        customerId: z.number().int().nullable().optional(),
      })
      .parse(input);
    return findSimilarJobs(user.tenantId, q);
  });
}

/** Current recommended price for reordering a job's first line at a quantity. */
export async function quoteReorderPrice(jobId: number, quantity: number) {
  return runAction(async () => {
    const user = await requirePermission("financials.view");
    const [job] = await db.select().from(jobs).where(and(eq(jobs.tenantId, user.tenantId), eq(jobs.id, jobId)));
    if (!job) throw new UserError("Job not found.");
    const [item] = await db.select().from(jobItems).where(and(eq(jobItems.tenantId, user.tenantId), eq(jobItems.jobId, jobId))).orderBy(asc(jobItems.sortOrder)).limit(1);
    if (!item) return { recommendedCents: null };
    // The stored input carries the print choices (paper, press, sides, colors…), so print work re-prices here too.
    const { altQuantities: _alt, ...input } = (item.pricingInput ?? {}) as Partial<ItemPricingRequest> & { altQuantities?: number[] };
    const { result: r } = await priceLine(user.tenantId, {
      ...input,
      categoryId: item.categoryId,
      quantity: Math.max(1, Math.round(quantity)),
      widthIn: item.widthIn,
      heightIn: item.heightIn,
      materialId: item.materialId,
      customerId: job.customerId,
      needsDesign: false, // artwork already exists on a reorder
    });
    return { recommendedCents: r.recommendedCents > 0 ? r.recommendedCents : null };
  });
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------
const Item = z.object({
  id: z.number().int().optional().nullable(),
  categoryId: z.number().int().nullable(),
  description: z.string().trim().min(1, "Every line needs a description.").max(500),
  quantity: z.number().int().min(1, "Quantity must be at least 1.").max(10_000_000),
  widthIn: z.number().min(0).nullable(),
  heightIn: z.number().min(0).nullable(),
  materialId: z.number().int().nullable(),
  material: z.string().max(200).nullable(),
  finishing: z.string().max(300).nullable(),
  finishingKeys: z.array(z.string()).max(30),
  colors: z.string().max(100).nullable(),
  specs: z.string().max(2000).nullable(),
  designHours: z.number().min(0).nullable(),
  installHours: z.number().min(0).nullable(),
  miles: z.number().min(0).nullable(),
  outsourcedCostCents: z.number().int().min(0).nullable(),
  customBaseCents: z.number().int().min(0).nullable(),
  print: PrintSpec.nullable().optional(),
  altQuantities: AltQuantities.optional(),
  priceCents: z.number().int().min(0),
  overrideReason: z.string().max(300).nullable(),
  taxable: z.boolean(),
});
const Quote = z.object({
  id: z.number().int().nullable(),
  customerId: z.number({ message: "Choose a customer." }).int(),
  contactId: z.number().int().nullable(),
  title: z.string().trim().min(1, "Give the quote a short title.").max(200),
  salespersonId: z.number().int().nullable(),
  locationId: z.number().int().nullable(),
  needsDesign: z.boolean(),
  needsInstall: z.boolean(),
  isRush: z.boolean(),
  dueDate: z.string().nullable(),
  validUntil: z.string().nullable(),
  internalNotes: z.string().max(5000).nullable(),
  customerNotes: z.string().max(5000).nullable(),
  items: z.array(Item).min(1, "Add at least one line."),
});
export type QuotePayload = z.infer<typeof Quote>;

/** Ids picked in the builder must belong to this shop: another shop's ids are simply "not found". */
async function checkQuoteRefs(tenantId: number, data: QuotePayload) {
  if (data.contactId) {
    const [c] = await db.select({ id: customerContacts.id }).from(customerContacts).where(and(eq(customerContacts.tenantId, tenantId), eq(customerContacts.id, data.contactId)));
    if (!c) throw new UserError("Contact not found.");
  }
  if (data.salespersonId) {
    const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, data.salespersonId)));
    if (!u) throw new UserError("Salesperson not found.");
  }
  if (data.locationId) {
    const [l] = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, data.locationId)));
    if (!l) throw new UserError("Location not found.");
  }
  const catIds = [...new Set(data.items.map((i) => i.categoryId).filter((x): x is number => x != null))];
  const methods = new Map<number, string>();
  if (catIds.length) {
    const found = await db.select({ id: productCategories.id, method: productCategories.pricingMethod }).from(productCategories).where(and(eq(productCategories.tenantId, tenantId), inArray(productCategories.id, catIds)));
    if (found.length !== catIds.length) throw new UserError("Product category not found.");
    for (const c of found) methods.set(c.id, c.method);
  }
  const uniq = (xs: (number | null | undefined)[]) => [...new Set(xs.filter((x): x is number => x != null))];
  const matIds = uniq(data.items.map((i) => i.materialId));
  if (matIds.length) {
    const found = await db.select({ id: materials.id }).from(materials).where(and(eq(materials.tenantId, tenantId), inArray(materials.id, matIds)));
    if (found.length !== matIds.length) throw new UserError("Material not found.");
  }
  // Print choices: paper, press and services must be this shop's too.
  const paperIds = uniq(data.items.map((i) => i.print?.paperId));
  if (paperIds.length) {
    const found = await db.select({ id: materials.id }).from(materials).where(and(eq(materials.tenantId, tenantId), inArray(materials.id, paperIds)));
    if (found.length !== paperIds.length) throw new UserError("Paper not found.");
  }
  const pressIds = uniq(data.items.map((i) => i.print?.pressId));
  if (pressIds.length) {
    const found = await db.select({ id: equipment.id }).from(equipment).where(and(eq(equipment.tenantId, tenantId), inArray(equipment.id, pressIds)));
    if (found.length !== pressIds.length) throw new UserError("Press not found.");
  }
  const opIds = uniq(data.items.flatMap((i) => i.print?.operationIds ?? []));
  if (opIds.length) {
    const found = await db.select({ id: operations.id }).from(operations).where(and(eq(operations.tenantId, tenantId), inArray(operations.id, opIds)));
    if (found.length !== opIds.length) throw new UserError("Service not found.");
  }
  return { methods };
}

export async function saveQuote(payload: QuotePayload) {
  return runAction(async () => {
    const user = await requirePermission("quotes.edit");
    const data = Quote.parse(payload);
    const [cust] = await db.select().from(customers).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, data.customerId)));
    if (!cust) throw new UserError("Customer not found.");
    const { methods } = await checkQuoteRefs(user.tenantId, data);
    const { rules, quoteValidDays } = await getSettings(user.tenantId);

    // Authoritative pricing on the server.
    const priced = await Promise.all(
      data.items.map(async (i, idx) => {
        const req: ItemPricingRequest = {
          categoryId: i.categoryId,
          quantity: i.quantity,
          widthIn: i.widthIn,
          heightIn: i.heightIn,
          materialId: i.materialId,
          finishingKeys: i.finishingKeys,
          needsDesign: data.needsDesign && idx === 0,
          designHours: i.designHours,
          needsInstall: data.needsInstall && idx === 0,
          installHours: i.installHours,
          miles: i.miles,
          outsourcedCostCents: i.outsourcedCostCents,
          isRush: data.isRush,
          customBaseCents: i.customBaseCents,
          customerId: data.customerId,
          // Print choices only count for print-estimated categories.
          print: i.categoryId != null && methods.get(i.categoryId) === "sheet_fed" ? (i.print ?? null) : null,
        };
        const altQuantities = [...new Set(i.altQuantities ?? [])].filter((q) => q !== i.quantity).sort((a, b) => a - b);
        const p = await priceLine(user.tenantId, req, altQuantities);
        const r = p.result;
        const { customerId: _c, ...rest } = p.req;
        const pricingInput = { ...rest, ...(altQuantities.length ? { altQuantities } : {}) };
        return {
          categoryId: i.categoryId,
          description: i.description,
          quantity: i.quantity,
          widthIn: i.widthIn,
          heightIn: i.heightIn,
          materialId: i.materialId,
          material: i.material,
          finishing: i.finishing,
          colors: i.colors,
          specs: i.specs,
          pricingInput,
          pricingBreakdown: storedBreakdown(p),
          recommendedCents: r.recommendedCents,
          priceCents: i.priceCents,
          overrideReason: i.priceCents !== r.recommendedCents ? i.overrideReason : null,
          estimatedCostCents: r.estimatedCostCents,
          taxable: i.taxable,
          sortOrder: idx,
        };
      }),
    );
    const subtotal = priced.reduce((a, i) => a + i.priceCents, 0);
    const taxable = priced.filter((i) => i.taxable).reduce((a, i) => a + i.priceCents, 0);
    const taxRate = cust.taxExempt ? 0 : rules.taxRate;
    const tax = taxFor(taxable, taxRate, cust.taxExempt);
    const header = {
      customerId: data.customerId,
      contactId: data.contactId,
      title: data.title,
      salespersonId: data.salespersonId ?? user.id,
      locationId: data.locationId,
      needsDesign: data.needsDesign,
      needsInstall: data.needsInstall,
      isRush: data.isRush,
      dueDate: data.dueDate,
      validUntil: data.validUntil ?? addDays(today(), quoteValidDays),
      subtotalCents: subtotal,
      taxRate,
      taxCents: tax,
      totalCents: subtotal + tax,
      estimatedCostCents: priced.reduce((a, i) => a + i.estimatedCostCents, 0),
      internalNotes: data.internalNotes,
      customerNotes: data.customerNotes,
      updatedAt: new Date(),
    };

    const id = await db.transaction(async (tx) => {
      if (data.id) {
        const [before] = await tx.select().from(quotes).where(and(eq(quotes.tenantId, user.tenantId), eq(quotes.id, data.id))).for("update");
        if (!before) throw new UserError("Quote not found.");
        if (before.status === "converted") throw new UserError("This quote was already converted to a job. Edit the job instead.");
        const beforeItems = await tx.select().from(quoteItems).where(and(eq(quoteItems.tenantId, user.tenantId), eq(quoteItems.quoteId, data.id)));
        await tx.update(quotes).set(header).where(and(eq(quotes.tenantId, user.tenantId), eq(quotes.id, data.id)));
        await tx.delete(quoteItems).where(and(eq(quoteItems.tenantId, user.tenantId), eq(quoteItems.quoteId, data.id)));
        await tx.insert(quoteItems).values(priced.map((p) => ({ ...p, tenantId: user.tenantId, quoteId: data.id! })));
        if (before.subtotalCents !== subtotal) {
          await logActivity(
            {
              tenantId: user.tenantId,
              action: "quote.price_changed",
              entityType: "quote",
              entityId: data.id,
              quoteId: data.id,
              customerId: data.customerId,
              actorId: user.id,
              summary: `Price changed ${money(before.subtotalCents)} → ${money(subtotal)}`,
              data: { before: { subtotalCents: before.subtotalCents, items: beforeItems.map((i) => ({ d: i.description, p: i.priceCents })) }, after: { subtotalCents: subtotal, items: priced.map((i) => ({ d: i.description, p: i.priceCents })) } },
            },
            tx,
          );
        } else {
          await logActivity({ tenantId: user.tenantId, action: "quote.updated", entityType: "quote", entityId: data.id, quoteId: data.id, customerId: data.customerId, actorId: user.id, summary: "Edited quote" }, tx);
        }
        return data.id;
      }
      const number = await nextNumber(tx, user.tenantId, "quote");
      const [q] = await tx.insert(quotes).values({ ...header, tenantId: user.tenantId, number, status: "draft", createdBy: user.id }).returning();
      await tx.insert(quoteItems).values(priced.map((p) => ({ ...p, tenantId: user.tenantId, quoteId: q!.id })));
      await logActivity({ tenantId: user.tenantId, action: "quote.created", entityType: "quote", entityId: q!.id, quoteId: q!.id, customerId: data.customerId, actorId: user.id, summary: `Created quote for ${money(subtotal)}` }, tx);
      return q!.id;
    });
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${id}`);
    revalidatePath("/dashboard");
    return { id };
  }, "Quote saved");
}

// ---------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------
/**
 * Customer portal link for a quote email: signs the recipient in (as a person at this customer) and opens
 * the quote, where they can accept or decline it. Null when staff turned portal access off for that email.
 */
async function quotePortalLink(tenantId: number, q: { id: number; customerId: number }, email: string, contact: { id: number; email: string | null } | null, userId: number): Promise<{ url: string; canAccept: boolean } | null> {
  try {
    const portal = await getPortalSettings(tenantId);
    if (!portal.enabled || (await portalAccessBlocked(tenantId, q.customerId, email))) return null;
    const contactId = contact && contact.email?.trim().toLowerCase() === email.toLowerCase() ? contact.id : ((await contactForEmail(tenantId, q.customerId, email))?.id ?? null);
    const token = await createPortalLink(db, tenantId, { customerId: q.customerId, contactId, email, createdBy: userId, days: QUOTE_LINK_DAYS });
    return { url: await portalLinkUrl(token, `/portal/quotes/${q.id}`), canAccept: portal.features.quotes };
  } catch (e) {
    console.error("[quote portal link]", e);
    return null;
  }
}

async function loadQuote(tenantId: number, id: number) {
  const [q] = await db.select().from(quotes).where(and(eq(quotes.tenantId, tenantId), eq(quotes.id, id)));
  if (!q) throw new UserError("Quote not found.");
  return q;
}

/** Email the quote to the customer (or just mark it sent when given over the counter/phone). */
export async function sendQuote(id: number, opts: { email: string | null; message: string | null }) {
  return runAction(async () => {
    const user = await requirePermission("quotes.edit");
    const q = await loadQuote(user.tenantId, id);
    if (q.status === "converted") throw new UserError("This quote is already a job.");
    let sentTo: string | null = null;
    if (opts.email) {
      const email = z.string().email("Enter a valid email address.").parse(opts.email.trim());
      const items = await db.select().from(quoteItems).where(and(eq(quoteItems.tenantId, user.tenantId), eq(quoteItems.quoteId, id))).orderBy(asc(quoteItems.sortOrder));
      const [contact] = q.contactId ? await db.select().from(customerContacts).where(and(eq(customerContacts.tenantId, user.tenantId), eq(customerContacts.id, q.contactId))) : [];
      const { company } = await getSettings(user.tenantId);
      // "View and accept online": a customer portal sign-in link for this email that opens this quote.
      const portalLink = await quotePortalLink(user.tenantId, q, email, contact ?? null, user.id);
      const subject = `Your quote from ${company.name}: ${q.title} (${quoteNo(q.number)})`;
      const text = [
        `Hello${contact ? ` ${contact.name.split(" ")[0]}` : ""},`,
        ``,
        `Thank you for the opportunity. Here is your quote for "${q.title}":`,
        ``,
        ...items.flatMap((i) => {
          const line = `• ${i.description}${i.widthIn && i.heightIn ? ` (${fmtSize(i.widthIn, i.heightIn)})` : ""} — qty ${i.quantity.toLocaleString()} — ${money(i.priceCents)}`;
          const choices = quantityOptionsText(i.quantity, i.priceCents, (i.pricingBreakdown as StoredBreakdown | null)?.quantityOptions);
          return choices ? [line, `  Choose your quantity: ${choices}`] : [line];
        }),
        ``,
        `Subtotal: ${money(q.subtotalCents)}`,
        q.taxCents ? `Sales tax: ${money(q.taxCents)}` : `Sales tax: exempt`,
        `Total: ${money(q.totalCents)}`,
        ...(items.some((i) => quantityOptionsText(i.quantity, i.priceCents, (i.pricingBreakdown as StoredBreakdown | null)?.quantityOptions))
          ? [``, `The total is for the quantity on each line; the other quantities are priced before tax. Just tell us which you'd like.`]
          : []),
        q.validUntil ? `\nThis quote is valid until ${q.validUntil}.` : ``,
        q.customerNotes ? `\n${q.customerNotes}` : ``,
        opts.message ? `\n${opts.message}` : ``,
        ``,
        ...(portalLink ? [portalLink.canAccept ? `View and accept online:` : `View your quote online:`, portalLink.url, ``] : []),
        portalLink?.canAccept ? `Or reply to this email or call ${company.phone} to approve.` : `Reply to this email or call ${company.phone} to approve.`,
        ``,
        `${company.name} · ${company.address}`,
      ].join("\n");
      const res = await emailProvider().send({ to: email, subject, text, fromName: company.name, replyTo: company.email || undefined });
      if (!res.ok) throw new UserError("The email could not be sent.");
      await db.insert(communications).values({ tenantId: user.tenantId, customerId: q.customerId, quoteId: q.id, channel: "email", template: "quote_ready", toAddress: email, subject, body: text, status: "sent", providerId: res.providerId, sentBy: user.id });
      sentTo = email;
    }
    await db.update(quotes).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(and(eq(quotes.tenantId, user.tenantId), eq(quotes.id, id)));
    await logActivity({ tenantId: user.tenantId, action: "quote.sent", entityType: "quote", entityId: id, quoteId: id, customerId: q.customerId, actorId: user.id, summary: sentTo ? `Emailed quote to ${sentTo}` : "Marked quote as sent" });
    revalidatePath(`/quotes/${id}`);
    revalidatePath("/quotes");
  }, "Quote sent");
}

export async function setQuoteOutcome(id: number, outcome: "accepted" | "declined" | "expired" | "draft", reason?: string) {
  return runAction(async () => {
    const user = await requirePermission("quotes.edit");
    // Server Actions can be called with any value: never let a client set e.g. "converted".
    outcome = z.enum(["accepted", "declined", "expired", "draft"]).parse(outcome);
    const q = await loadQuote(user.tenantId, id);
    if (q.status === "converted") throw new UserError("This quote is already a job.");
    await db
      .update(quotes)
      .set({
        status: outcome,
        respondedAt: outcome === "draft" ? null : new Date(),
        lostReason: outcome === "declined" || outcome === "expired" ? (reason?.trim() || null) : null,
        // Set by staff, not the customer: clear any earlier online answer (it stays in the history).
        responseName: null,
        responseEmail: null,
        responseIp: null,
        responseNote: null,
        updatedAt: new Date(),
      })
      .where(and(eq(quotes.tenantId, user.tenantId), eq(quotes.id, id)));
    const label = { accepted: "Customer accepted quote", declined: `Quote declined${reason ? `: ${reason}` : ""}`, expired: "Quote marked expired", draft: "Quote reopened as draft" }[outcome];
    await logActivity({ tenantId: user.tenantId, action: `quote.${outcome}`, entityType: "quote", entityId: id, quoteId: id, customerId: q.customerId, actorId: user.id, summary: label });
    revalidatePath(`/quotes/${id}`);
    revalidatePath("/quotes");
    revalidatePath("/dashboard");
  }, outcome === "accepted" ? "Marked accepted" : "Saved");
}

/** ONE CLICK: accepted quote → job. */
export async function convertQuote(id: number) {
  const result = await runAction(async () => {
    const user = await requirePermission("jobs.create");
    const q = await loadQuote(user.tenantId, id);
    if (q.status === "declined" || q.status === "expired") throw new UserError("Reopen this quote before converting it.");
    const job = await convertQuoteToJob(id, user);
    revalidatePath("/quotes");
    revalidatePath("/jobs");
    revalidatePath("/dashboard");
    return job;
  });
  if (result.ok && result.data) redirect(`/jobs/${result.data.number}`);
  return result;
}

export async function duplicateQuote(id: number) {
  const result = await runAction(async () => {
    const user = await requirePermission("quotes.edit");
    const q = await loadQuote(user.tenantId, id);
    const items = await db.select().from(quoteItems).where(and(eq(quoteItems.tenantId, user.tenantId), eq(quoteItems.quoteId, id)));
    const { quoteValidDays } = await getSettings(user.tenantId);
    const newId = await db.transaction(async (tx) => {
      const { id: _i, number: _n, createdAt: _c, sentAt: _s, respondedAt: _r, status: _st, lostReason: _l, archivedAt: _a, ...rest } = q;
      const number = await nextNumber(tx, user.tenantId, "quote");
      const [n] = await tx.insert(quotes).values({ ...rest, number, title: q.title, status: "draft", validUntil: addDays(today(), quoteValidDays), createdBy: user.id, updatedAt: new Date() }).returning();
      if (items.length) await tx.insert(quoteItems).values(items.map(({ id: _x, quoteId: _q, ...i }) => ({ ...i, quoteId: n!.id })));
      await logActivity({ tenantId: user.tenantId, action: "quote.created", entityType: "quote", entityId: n!.id, quoteId: n!.id, customerId: q.customerId, actorId: user.id, summary: `Copied from ${quoteNo(q.number)}` }, tx);
      return n!.id;
    });
    return { id: newId };
  });
  if (result.ok && result.data) redirect(`/quotes/${result.data.id}`);
  return result;
}

export async function archiveQuote(id: number) {
  return runAction(async () => {
    const user = await requirePermission("quotes.edit");
    const q = await loadQuote(user.tenantId, id);
    await db.update(quotes).set({ archivedAt: new Date() }).where(and(eq(quotes.tenantId, user.tenantId), eq(quotes.id, id)));
    await logActivity({ tenantId: user.tenantId, action: "quote.archived", entityType: "quote", entityId: id, quoteId: id, customerId: q.customerId, actorId: user.id, summary: "Archived quote" });
    revalidatePath("/quotes");
  }, "Quote archived");
}
