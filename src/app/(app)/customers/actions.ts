"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { communications, customerContacts, customers, paymentTermsEnum, users } from "@/lib/db/schema";
import { requirePermission } from "@/lib/auth";
import { bool, runAction, str, UserError, type ActionResult } from "@/lib/actions";
import { diff, logActivity } from "@/lib/activity";
import { today } from "@/lib/format";
import { findDuplicateCustomers, getPrimaryContact, type DuplicateMatch } from "@/lib/customers/queries";
import { queueAccountingSync } from "@/lib/accounting";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const optText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label} is too long.`)
    .nullable();
const optEmail = (label: string) =>
  z
    .string()
    .max(200)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, `${label} doesn't look like an email address.`)
    .nullable();
const optPhone = (label: string) =>
  z
    .string()
    .max(40)
    .refine((v) => v.replace(/\D/g, "").length >= 7, `${label} needs at least 7 digits.`)
    .nullable();

const customerSchema = z.object({
  isCompany: z.boolean(),
  name: z.string({ error: "Please enter a name." }).min(1, "Please enter a name.").max(200, "That name is too long."),
  phone: optPhone("Phone"),
  email: optEmail("Email"),
  website: optText(200, "Website"),
  address: optText(300, "Address"),
  city: optText(100, "City"),
  state: z
    .string()
    .max(2, "Use the 2-letter state, like IN.")
    .transform((s) => s.toUpperCase())
    .nullable(),
  zip: z
    .string()
    .regex(/^\d{5}(-\d{4})?$/, "ZIP should look like 46321.")
    .nullable(),
  billingAddress: optText(600, "Billing address"),
  paymentTerms: z.enum(paymentTermsEnum.enumValues, { error: "Please pick payment terms." }),
  taxExempt: z.boolean(),
  taxExemptId: optText(100, "Exemption ID"),
  poRequired: z.boolean(),
  discountPct: z.number().min(0, "Discount can't be negative.").max(100, "Discount can't be more than 100%."),
  salespersonId: z.number().int().positive().nullable(),
  customerSince: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Customer since should be a date.")
    .nullable(),
  notes: optText(5000, "Notes"),
});

const contactSchema = z.object({
  name: z.string().min(1, "Please enter the contact's name.").max(200),
  title: optText(100, "Title"),
  email: optEmail("Contact email"),
  phone: optPhone("Contact phone"),
  notes: optText(2000, "Contact notes"),
  isPrimary: z.boolean(),
});

function parseCustomer(fd: FormData) {
  const discountRaw = str(fd, "discountPct")?.replace(/%/g, "") ?? "0";
  const discount = Number(discountRaw);
  if (!Number.isFinite(discount)) throw new UserError("Discount should be a number, like 5 for 5%.");
  const sp = str(fd, "salespersonId");
  const parsed = customerSchema.parse({
    isCompany: str(fd, "kind") !== "individual",
    name: str(fd, "name") ?? "",
    phone: str(fd, "phone"),
    email: str(fd, "email")?.toLowerCase() ?? null,
    website: str(fd, "website"),
    address: str(fd, "address"),
    city: str(fd, "city"),
    state: str(fd, "state"),
    zip: str(fd, "zip"),
    billingAddress: bool(fd, "sameBilling") ? null : (str(fd, "billingAddress")?.replace(/\r\n/g, "\n") ?? null),
    paymentTerms: str(fd, "paymentTerms") ?? "due_on_receipt",
    taxExempt: bool(fd, "taxExempt"),
    taxExemptId: str(fd, "taxExemptId"),
    poRequired: bool(fd, "poRequired"),
    discountPct: discount,
    salespersonId: sp ? Number(sp) : null,
    customerSince: str(fd, "customerSince"),
    notes: str(fd, "notes")?.replace(/\r\n/g, "\n") ?? null,
  });
  const { discountPct, ...rest } = parsed;
  return {
    ...rest,
    // Stored as a 0–1 fraction (numeric 5,2 → whole percents).
    discountPct: Math.round(discountPct) / 100,
    taxExemptId: parsed.taxExempt ? parsed.taxExemptId : null,
  };
}

function parseContact(fd: FormData, prefix = "") {
  const k = (n: string) => (prefix ? prefix + n[0].toUpperCase() + n.slice(1) : n);
  const values = {
    name: str(fd, k("name")),
    title: str(fd, k("title")),
    email: str(fd, k("email"))?.toLowerCase() ?? null,
    phone: str(fd, k("phone")),
    notes: prefix ? null : str(fd, "notes"),
    isPrimary: prefix ? true : bool(fd, "isPrimary"),
  };
  if (!values.name && !values.title && !values.email && !values.phone) return null;
  return contactSchema.parse({ ...values, name: values.name ?? "" });
}

async function assertSalesperson(tenantId: number, id: number | null) {
  if (!id) return;
  const [u] = await db.select({ role: users.role, active: users.active }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
  if (!u || !u.active || !["owner", "manager", "sales"].includes(u.role)) throw new UserError("Please pick a salesperson from the list.");
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export async function checkDuplicates(input: {
  name?: string;
  phone?: string;
  email?: string;
  excludeId?: number | null;
}): Promise<ActionResult<DuplicateMatch[]>> {
  return runAction(async () => {
    const user = await requirePermission("customers.edit");
    return findDuplicateCustomers(user.tenantId, {
      name: input.name?.slice(0, 200),
      phone: input.phone?.slice(0, 40),
      email: input.email?.slice(0, 200),
      excludeId: input.excludeId ?? null,
    });
  });
}

/**
 * Create (customerId = null) or update a customer.
 * Returns { duplicates } instead of saving when possible duplicates exist and the user hasn't confirmed.
 * Redirects to the customer page on success.
 */
export async function saveCustomer(customerId: number | null, fd: FormData): Promise<ActionResult<{ duplicates: DuplicateMatch[] }>> {
  return runAction(async () => {
    const user = await requirePermission("customers.edit");
    const values = parseCustomer(fd);
    const contact = parseContact(fd, "contact");
    const existing = customerId ? (await db.select().from(customers).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, customerId))))[0] : null;
    if (customerId && !existing) throw new UserError("This customer no longer exists.");
    if (values.salespersonId !== (existing?.salespersonId ?? null)) await assertSalesperson(user.tenantId, values.salespersonId);

    // Duplicate check (only when identifying fields are new or changed).
    const identityChanged =
      !existing ||
      existing.name.toLowerCase() !== values.name.toLowerCase() ||
      (existing.phone ?? "") !== (values.phone ?? "") ||
      (existing.email ?? "") !== (values.email ?? "");
    if (identityChanged && str(fd, "confirmDuplicate") !== "1") {
      const duplicates = await findDuplicateCustomers(user.tenantId, { name: values.name, phone: values.phone, email: values.email, excludeId: customerId });
      if (duplicates.length) return { duplicates };
    }

    let id: number;
    if (!existing) {
      id = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(customers)
          .values({ ...values, tenantId: user.tenantId, customerSince: values.customerSince ?? today() })
          .returning({ id: customers.id });
        if (contact) await tx.insert(customerContacts).values({ ...contact, tenantId: user.tenantId, customerId: row.id, isPrimary: true });
        await logActivity(
          { tenantId: user.tenantId, action: "customer.created", entityType: "customer", entityId: row.id, customerId: row.id, actorId: user.id, summary: `${user.name} added customer ${values.name}` },
          tx,
        );
        return row.id;
      });
    } else {
      id = existing.id;
      const primary = await getPrimaryContact(user.tenantId, id);
      await db.transaction(async (tx) => {
        await tx
          .update(customers)
          .set({ ...values, updatedAt: new Date() })
          .where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, id)));
        let contactChange: ReturnType<typeof diff> = null;
        if (contact) {
          if (primary) {
            const after = { name: contact.name, title: contact.title, email: contact.email, phone: contact.phone };
            contactChange = diff({ name: primary.name, title: primary.title, email: primary.email, phone: primary.phone }, after);
            if (contactChange)
              await tx
                .update(customerContacts)
                .set({ ...after, isPrimary: true })
                .where(and(eq(customerContacts.tenantId, user.tenantId), eq(customerContacts.id, primary.id)));
          } else {
            await tx.insert(customerContacts).values({ ...contact, tenantId: user.tenantId, customerId: id, isPrimary: true });
            contactChange = { before: {}, after: { primaryContact: contact.name } };
          }
        }
        const changes = diff(existing as unknown as Record<string, unknown>, values as unknown as Record<string, unknown>);
        if (changes || contactChange) {
          const fields = [...Object.keys(changes?.after ?? {}), ...(contactChange ? ["primary contact"] : [])];
          await logActivity(
            {
              tenantId: user.tenantId,
              action: "customer.updated",
              entityType: "customer",
              entityId: id,
              customerId: id,
              actorId: user.id,
              summary: `${user.name} updated ${values.name} (${fields.map(fieldLabel).join(", ")})`,
              data: { ...(changes ?? { before: {}, after: {} }), ...(contactChange ? { contact: contactChange } : {}) },
            },
            tx,
          );
        }
      });
    }
    // Customers already in QuickBooks get the edit too (unlinked ones are sent with their first invoice).
    if (existing?.externalId) await queueAccountingSync(user.tenantId, [{ type: "customer", id }]);
    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
    redirect(`/customers/${id}`);
  });
}

const FIELD_LABELS: Record<string, string> = {
  isCompany: "type",
  name: "name",
  phone: "phone",
  email: "email",
  website: "website",
  address: "address",
  city: "city",
  state: "state",
  zip: "ZIP",
  billingAddress: "billing address",
  paymentTerms: "payment terms",
  taxExempt: "tax exempt",
  taxExemptId: "exemption ID",
  poRequired: "PO required",
  discountPct: "discount",
  salespersonId: "salesperson",
  customerSince: "customer since",
  notes: "notes",
};
const fieldLabel = (k: string) => FIELD_LABELS[k] ?? k;

export async function archiveCustomer(id: number): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("customers.edit");
    const [c] = await db
      .update(customers)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, id), isNull(customers.archivedAt)))
      .returning({ name: customers.name });
    if (!c) throw new UserError("This customer is already archived.");
    await logActivity({ tenantId: user.tenantId, action: "customer.archived", entityType: "customer", entityId: id, customerId: id, actorId: user.id, summary: `${user.name} archived ${c.name}` });
    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
  }, "Customer archived");
}

export async function restoreCustomer(id: number): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("customers.edit");
    const [c] = await db
      .update(customers)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, id)))
      .returning({ name: customers.name });
    if (!c) throw new UserError("Customer not found.");
    await logActivity({ tenantId: user.tenantId, action: "customer.restored", entityType: "customer", entityId: id, customerId: id, actorId: user.id, summary: `${user.name} restored ${c.name}` });
    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
  }, "Customer restored");
}

export async function updateCustomerNotes(id: number, notesRaw: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("customers.edit");
    const notes = notesRaw.trim().slice(0, 5000) || null;
    const [before] = await db.select({ notes: customers.notes, name: customers.name }).from(customers).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, id)));
    if (!before) throw new UserError("Customer not found.");
    if ((before.notes ?? null) === notes) return;
    await db.update(customers).set({ notes, updatedAt: new Date() }).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, id)));
    await logActivity({
      tenantId: user.tenantId,
      action: "customer.updated",
      entityType: "customer",
      entityId: id,
      customerId: id,
      actorId: user.id,
      summary: `${user.name} updated notes for ${before.name}`,
      data: diff({ notes: before.notes }, { notes }),
    });
    revalidatePath(`/customers/${id}`);
  }, "Notes saved");
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------
export async function saveContact(customerId: number, contactId: number | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("customers.edit");
    const contact = parseContact(fd);
    if (!contact) throw new UserError("Please enter the contact's name.");
    const [c] = await db.select({ name: customers.name }).from(customers).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, customerId)));
    if (!c) throw new UserError("Customer not found.");
    await db.transaction(async (tx) => {
      if (contact.isPrimary)
        await tx.update(customerContacts).set({ isPrimary: false }).where(and(eq(customerContacts.tenantId, user.tenantId), eq(customerContacts.customerId, customerId)));
      if (contactId) {
        const [before] = await tx
          .select()
          .from(customerContacts)
          .where(and(eq(customerContacts.tenantId, user.tenantId), eq(customerContacts.id, contactId), eq(customerContacts.customerId, customerId)));
        if (!before) throw new UserError("Contact not found.");
        await tx.update(customerContacts).set(contact).where(and(eq(customerContacts.tenantId, user.tenantId), eq(customerContacts.id, contactId)));
        const changes = diff(before as unknown as Record<string, unknown>, contact);
        if (changes)
          await logActivity(
            { tenantId: user.tenantId, action: "customer.contact_updated", entityType: "customer", entityId: customerId, customerId, actorId: user.id, summary: `${user.name} updated contact ${contact.name}`, data: changes },
            tx,
          );
      } else {
        await tx.insert(customerContacts).values({ ...contact, tenantId: user.tenantId, customerId });
        await logActivity(
          { tenantId: user.tenantId, action: "customer.contact_added", entityType: "customer", entityId: customerId, customerId, actorId: user.id, summary: `${user.name} added contact ${contact.name}` },
          tx,
        );
      }
    });
    revalidatePath(`/customers/${customerId}`);
  }, contactId ? "Contact saved" : "Contact added");
}

export async function archiveContact(customerId: number, contactId: number): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("customers.edit");
    const [c] = await db
      .update(customerContacts)
      .set({ archivedAt: new Date(), isPrimary: false })
      .where(and(eq(customerContacts.tenantId, user.tenantId), eq(customerContacts.id, contactId), eq(customerContacts.customerId, customerId)))
      .returning({ name: customerContacts.name });
    if (!c) throw new UserError("Contact not found.");
    await logActivity({ tenantId: user.tenantId, action: "customer.contact_removed", entityType: "customer", entityId: customerId, customerId, actorId: user.id, summary: `${user.name} removed contact ${c.name}` });
    revalidatePath(`/customers/${customerId}`);
  }, "Contact removed");
}

// ---------------------------------------------------------------------------
// Communication log
// ---------------------------------------------------------------------------
const commSchema = z.object({
  channel: z.enum(["phone", "note"], { error: "Pick call or note." }),
  direction: z.enum(["inbound", "outbound"]),
  subject: z.string().max(200).nullable(),
  body: z.string({ error: "Please write what was said." }).min(1, "Please write what was said.").max(5000, "That note is too long."),
});

export async function logCommunication(customerId: number, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("customers.edit");
    const v = commSchema.parse({
      channel: str(fd, "channel") ?? "phone",
      direction: str(fd, "direction") ?? "inbound",
      subject: str(fd, "subject"),
      body: str(fd, "body") ?? "",
    });
    const [c] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, customerId)));
    if (!c) throw new UserError("Customer not found.");
    await db.insert(communications).values({
      tenantId: user.tenantId,
      customerId,
      channel: v.channel,
      direction: v.channel === "note" ? "outbound" : v.direction,
      subject: v.subject,
      body: v.body,
      status: "logged",
      sentBy: user.id,
    });
    revalidatePath(`/customers/${customerId}`);
  }, "Saved to the log");
}

// ---------------------------------------------------------------------------
// Quick add (from the customer picker: counter, quote builder, new job)
// ---------------------------------------------------------------------------
const quickCustomerSchema = z.object({
  isCompany: z.boolean(),
  name: z.string().trim().min(1, "Please enter a name.").max(200, "That name is too long."),
  phone: optPhone("Phone"),
  email: optEmail("Email"),
  taxExempt: z.boolean(),
  contactName: optText(200, "Contact name"),
  confirmDuplicate: z.boolean().optional(),
});

/** What the picker needs to select the new customer (same shape as /api/customers/search). */
export type QuickCustomer = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  taxExempt: boolean;
  discountPct: number;
  poRequired: boolean;
  salespersonId: number | null;
  contacts: { id: number; name: string; email: string | null; isPrimary: boolean }[];
};

/**
 * Create a customer with just the basics without leaving the page. Like saveCustomer, possible
 * duplicates are returned first (unless confirmed) so the person can pick the existing one.
 */
export async function quickCreateCustomer(input: z.input<typeof quickCustomerSchema>): Promise<ActionResult<{ duplicates?: DuplicateMatch[]; customer?: QuickCustomer }>> {
  return runAction(async () => {
    const user = await requirePermission("customers.edit");
    const blank = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);
    const v = quickCustomerSchema.parse({ ...input, phone: blank(input.phone), email: blank(input.email)?.toLowerCase() ?? null, contactName: blank(input.contactName) });
    if (!v.confirmDuplicate) {
      const duplicates = await findDuplicateCustomers(user.tenantId, { name: v.name, phone: v.phone, email: v.email });
      if (duplicates.length) return { duplicates };
    }
    const customer = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(customers)
        .values({ tenantId: user.tenantId, name: v.name, isCompany: v.isCompany, phone: v.phone, email: v.email, taxExempt: v.taxExempt, paymentTerms: "due_on_receipt", customerSince: today() })
        .returning();
      const contacts = v.contactName
        ? await tx
            .insert(customerContacts)
            .values({ tenantId: user.tenantId, customerId: row!.id, name: v.contactName, isPrimary: true })
            .returning({ id: customerContacts.id, name: customerContacts.name, email: customerContacts.email, isPrimary: customerContacts.isPrimary })
        : [];
      await logActivity(
        { tenantId: user.tenantId, action: "customer.created", entityType: "customer", entityId: row!.id, customerId: row!.id, actorId: user.id, summary: `${user.name} added customer ${v.name} (quick add)` },
        tx,
      );
      return { id: row!.id, name: row!.name, phone: row!.phone, email: row!.email, city: row!.city, taxExempt: row!.taxExempt, discountPct: row!.discountPct, poRequired: row!.poRequired, salespersonId: row!.salespersonId, contacts };
    });
    revalidatePath("/customers");
    return { customer };
  }, "Customer added");
}
