"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { communications, customerContacts, customers, jobItems, jobs, locations, materials, productCategories, quoteItems, quotes, users } from "@/lib/db/schema";
import { requirePermission } from "@/lib/auth";
import { nextNumber } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { runAction, UserError } from "@/lib/actions";
import { logActivity } from "@/lib/activity";
import { priceItem, publicResult, type ItemPricingRequest } from "@/lib/pricing/server";
import { findSimilarJobs, type SimilarQuery } from "@/lib/pricing/history";
import { convertQuoteToJob } from "@/lib/jobs/service";
import { getSettings } from "@/lib/settings";
import { addDays, fmtSize, money, quoteNo, today } from "@/lib/format";
import { taxFor } from "@/lib/pricing/engine";
import { emailProvider } from "@/lib/email";

// ---------------------------------------------------------------------------
// Live pricing & history (called while typing in the quote builder)
// ---------------------------------------------------------------------------
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
});

export async function priceQuoteItem(input: ItemPricingRequest) {
  return runAction(async () => {
    const user = await requirePermission("quotes.edit");
    const req = PricingReq.parse(input);
    return publicResult(await priceItem(user.tenantId, req), can(user.role, "margins.view"));
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
    const input = (item.pricingInput ?? {}) as Partial<ItemPricingRequest>;
    const r = await priceItem(user.tenantId, {
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
  if (catIds.length) {
    const found = await db.select({ id: productCategories.id }).from(productCategories).where(and(eq(productCategories.tenantId, tenantId), inArray(productCategories.id, catIds)));
    if (found.length !== catIds.length) throw new UserError("Product category not found.");
  }
  const matIds = [...new Set(data.items.map((i) => i.materialId).filter((x): x is number => x != null))];
  if (matIds.length) {
    const found = await db.select({ id: materials.id }).from(materials).where(and(eq(materials.tenantId, tenantId), inArray(materials.id, matIds)));
    if (found.length !== matIds.length) throw new UserError("Material not found.");
  }
}

export async function saveQuote(payload: QuotePayload) {
  return runAction(async () => {
    const user = await requirePermission("quotes.edit");
    const data = Quote.parse(payload);
    const [cust] = await db.select().from(customers).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, data.customerId)));
    if (!cust) throw new UserError("Customer not found.");
    await checkQuoteRefs(user.tenantId, data);
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
        };
        const r = await priceItem(user.tenantId, req);
        const { customerId: _c, ...pricingInput } = req;
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
          pricingBreakdown: { lines: r.lines, costLines: r.costLines, warnings: r.warnings },
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
      const subject = `Your quote from ${company.name}: ${q.title} (${quoteNo(q.number)})`;
      const text = [
        `Hello${contact ? ` ${contact.name.split(" ")[0]}` : ""},`,
        ``,
        `Thank you for the opportunity. Here is your quote for "${q.title}":`,
        ``,
        ...items.map((i) => `• ${i.description}${i.widthIn && i.heightIn ? ` (${fmtSize(i.widthIn, i.heightIn)})` : ""} — qty ${i.quantity.toLocaleString()} — ${money(i.priceCents)}`),
        ``,
        `Subtotal: ${money(q.subtotalCents)}`,
        q.taxCents ? `Sales tax: ${money(q.taxCents)}` : `Sales tax: exempt`,
        `Total: ${money(q.totalCents)}`,
        q.validUntil ? `\nThis quote is valid until ${q.validUntil}.` : ``,
        q.customerNotes ? `\n${q.customerNotes}` : ``,
        opts.message ? `\n${opts.message}` : ``,
        ``,
        `Reply to this email or call ${company.phone} to approve.`,
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
      .set({ status: outcome, respondedAt: outcome === "draft" ? null : new Date(), lostReason: outcome === "declined" || outcome === "expired" ? (reason?.trim() || null) : null, updatedAt: new Date() })
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
