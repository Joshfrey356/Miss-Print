import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerContacts, customers, pricingRules, productCategories, quoteItems, quotes } from "@/lib/db/schema";
import { getActiveUsers, getLocations, getMaterials } from "@/lib/lookups";
import { getSettings } from "@/lib/settings";
import type { PricingConfig } from "@/lib/pricing/engine";
import type { BuilderCategory, BuilderInitial } from "@/components/quotes/quote-builder";
import type { PickedCustomer } from "@/components/customer-picker";

/** Everything the quote builder needs. Costs are NOT included (pricing runs on the server). */
export async function builderOptions(tenantId: number) {
  const [cats, mats, people, locations, { rules }] = await Promise.all([
    db
      .select({ id: productCategories.id, name: productCategories.name, method: productCategories.pricingMethod, config: pricingRules.config, notes: pricingRules.notes, defaultNeedsInstall: productCategories.defaultNeedsInstall, defaultLocationId: productCategories.defaultLocationId })
      .from(productCategories)
      .leftJoin(pricingRules, and(eq(pricingRules.categoryId, productCategories.id), eq(pricingRules.tenantId, tenantId)))
      .where(and(eq(productCategories.tenantId, tenantId), eq(productCategories.active, true)))
      .orderBy(asc(productCategories.sortOrder)),
    getMaterials(tenantId),
    getActiveUsers(tenantId),
    getLocations(tenantId),
    getSettings(tenantId),
  ]);
  const categories: BuilderCategory[] = cats.map((c) => ({
    id: c.id,
    name: c.name,
    method: c.method,
    notes: c.notes,
    defaultNeedsInstall: c.defaultNeedsInstall,
    defaultLocationId: c.defaultLocationId,
    finishing: ((c.config as PricingConfig | null)?.finishingOptions ?? []).map((f) => ({ key: f.key, label: f.label, basis: f.basis, priceCents: f.priceCents })),
  }));
  return {
    categories,
    materials: mats.map((m) => ({ id: m.id, name: m.name, unit: m.unit, kind: m.kind })),
    salespeople: people.filter((p) => ["owner", "manager", "sales"].includes(p.role)).map((p) => ({ id: p.id, name: p.name })),
    locations: locations.map((l) => ({ id: l.id, name: l.name })),
    taxRate: rules.taxRate,
  };
}

export async function pickedCustomer(tenantId: number, id: number): Promise<PickedCustomer | null> {
  const [c] = await db.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, id)));
  if (!c) return null;
  const contacts = await db
    .select({ id: customerContacts.id, name: customerContacts.name, email: customerContacts.email, isPrimary: customerContacts.isPrimary })
    .from(customerContacts)
    .where(and(eq(customerContacts.tenantId, tenantId), eq(customerContacts.customerId, id), isNull(customerContacts.archivedAt)));
  return { id: c.id, name: c.name, phone: c.phone, email: c.email, city: c.city, taxExempt: c.taxExempt, discountPct: c.discountPct, poRequired: c.poRequired, salespersonId: c.salespersonId, contacts };
}

export async function quoteForBuilder(tenantId: number, id: number): Promise<BuilderInitial | null> {
  const [q] = await db.select().from(quotes).where(and(eq(quotes.tenantId, tenantId), eq(quotes.id, id)));
  if (!q) return null;
  const items = await db.select().from(quoteItems).where(and(eq(quoteItems.tenantId, tenantId), inArray(quoteItems.quoteId, [id]))).orderBy(asc(quoteItems.sortOrder));
  return {
    id: q.id,
    customer: await pickedCustomer(tenantId, q.customerId),
    contactId: q.contactId,
    title: q.title,
    salespersonId: q.salespersonId,
    locationId: q.locationId,
    needsDesign: q.needsDesign,
    needsInstall: q.needsInstall,
    isRush: q.isRush,
    dueDate: q.dueDate,
    validUntil: q.validUntil,
    internalNotes: q.internalNotes,
    customerNotes: q.customerNotes,
    items: items.map((i) => ({
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
      pricingInput: i.pricingInput as Record<string, unknown> | null,
      priceCents: i.priceCents,
      recommendedCents: i.recommendedCents,
      overrideReason: i.overrideReason,
      taxable: i.taxable,
    })),
  };
}
