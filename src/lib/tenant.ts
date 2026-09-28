import "server-only";
import { cache } from "react";
import { eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { tenants, type Tenant } from "@/lib/db/schema";

/**
 * Tenants: each print shop using the Command Center is one tenant.
 * People belong to exactly one shop (their email decides which), and every business
 * row carries `tenant_id`. Scope every query with `eq(<table>.tenantId, user.tenantId)`.
 */

/** Remembers the last shop signed in on this device, so /login shows that shop's brand. */
export const SHOP_COOKIE = "mp_shop";

export const getTenant = cache(async (id: number): Promise<Tenant | undefined> => {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, id));
  return t;
});

export const getTenantBySlug = cache(async (slug: string): Promise<Tenant | undefined> => {
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, slug.toLowerCase()));
  return t;
});

/** The shop's job number prefix ("MP" → MP-10428). */
export async function getJobPrefix(tenantId: number): Promise<string> {
  return (await getTenant(tenantId))?.jobPrefix ?? "J";
}

/** Public URL of the shop's logo (cache-busted by upload time), or null when none is uploaded. */
export function tenantLogoUrl(t: Pick<Tenant, "id" | "logoStorageKey" | "logoUpdatedAt">): string | null {
  if (!t.logoStorageKey) return null;
  return `/brand/${t.id}/logo?v=${t.logoUpdatedAt?.getTime() ?? 0}`;
}

export type NumberKind = "job" | "quote" | "invoice" | "po";
const COUNTERS = {
  job: tenants.nextJobNumber,
  quote: tenants.nextQuoteNumber,
  invoice: tenants.nextInvoiceNumber,
  po: tenants.nextPoNumber,
} as const;

/**
 * Hand out the next job/quote/invoice/purchase-order number for a shop. Call inside the transaction
 * that inserts the row: the counter row stays locked until it commits, so numbers never collide.
 */
export async function nextNumber(tx: Tx | typeof db, tenantId: number, kind: NumberKind): Promise<number> {
  const col = COUNTERS[kind];
  const bump = sql`${col} + 1`;
  const set =
    kind === "job" ? { nextJobNumber: bump } : kind === "quote" ? { nextQuoteNumber: bump } : kind === "invoice" ? { nextInvoiceNumber: bump } : { nextPoNumber: bump };
  // RETURNING sees the incremented value, so the number handed out is one less.
  const [row] = await tx.update(tenants).set(set).where(eq(tenants.id, tenantId)).returning({ n: sql<number>`${col} - 1` });
  if (!row) throw new Error(`Shop ${tenantId} not found`);
  return Number(row.n);
}

/** "Joe's Signs & Print, LLC" → "joes-signs-print-llc" */
export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50)
      .replace(/-+$/g, "") || "shop"
  );
}

/** A slug no other shop uses: "joes-signs", "joes-signs-2", … */
export async function uniqueSlug(tx: Tx | typeof db, name: string) {
  const base = slugify(name);
  const taken = new Set(
    (await tx.select({ slug: tenants.slug }).from(tenants).where(sql`${tenants.slug} = ${base} or ${tenants.slug} like ${base + "-%"}`)).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}
