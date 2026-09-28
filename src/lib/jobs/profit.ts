import "server-only";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { expenses, invoices, jobs } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";
import { marginOf } from "@/lib/pricing/engine";
import { jobPurchaseCostsSql, type JobPurchaseCostRow } from "@/lib/inventory/cost-sql";

const MATERIAL = ["materials", "ink_toner", "paper", "vinyl", "substrates"];
const OUTSIDE = ["outside_services", "installation", "shipping"];

/**
 * Quoted vs actual profitability for one job. Actual cost = attached expenses + purchase orders charged
 * to the job + stock used on it (at the material's cost) + labor hours × labor cost.
 */
export async function getJobProfitability(tenantId: number, jobId: number) {
  const [job] = await db.select().from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId)));
  if (!job) return null;
  const { rules } = await getSettings(tenantId);
  const rows = await db
    .select({ category: expenses.category, cents: sql<number>`sum(${expenses.amountCents})::int` })
    .from(expenses)
    .where(and(eq(expenses.tenantId, tenantId), eq(expenses.jobId, jobId), isNull(expenses.archivedAt)))
    .groupBy(expenses.category);
  const sum = (cats: string[]) => rows.filter((r) => cats.includes(r.category)).reduce((a, r) => a + r.cents, 0);
  // Inventory & purchasing: PO lines for the job, and stock taken off the shelf for it.
  // Same definition as Money → Profitability and the profit reports (src/lib/inventory/cost-sql.ts).
  const [pc] = (await db.execute(jobPurchaseCostsSql(tenantId, (col) => sql`${col} = ${jobId}`))) as unknown as JobPurchaseCostRow[];
  const purchases = {
    stockCents: pc?.stock_cents ?? 0,
    purchasedMaterialCents: pc?.purchased_material_cents ?? 0,
    outsideCents: pc?.po_outside_cents ?? 0,
    materialCents: (pc?.stock_cents ?? 0) + (pc?.purchased_material_cents ?? 0),
  };
  const expenseMaterialCents = sum(MATERIAL);
  const expenseOutsideCents = sum(OUTSIDE);
  const otherCents = rows.reduce((a, r) => a + r.cents, 0) - expenseMaterialCents - expenseOutsideCents;
  const materialCents = expenseMaterialCents + purchases.materialCents;
  const outsideCents = expenseOutsideCents + purchases.outsideCents;
  const laborCents = Math.round((job.laborHours ?? 0) * rules.laborCostPerHourCents);
  const actualCostCents = materialCents + outsideCents + otherCents + laborCents;
  const [inv] = await db
    .select({ subtotal: invoices.subtotalCents })
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.jobId, jobId), ne(invoices.status, "void")));
  const revenueCents = inv?.subtotal ?? job.subtotalCents; // revenue excludes sales tax
  return {
    revenueCents,
    quotedCostCents: job.estimatedCostCents,
    quotedMarginPct: marginOf(job.subtotalCents, job.estimatedCostCents),
    materialCents,
    outsideCents,
    /** The breakdown of materialCents + outsideCents: attached expenses, stock used (at cost), purchase orders charged to the job. */
    expenseMaterialCents,
    expenseOutsideCents,
    stockUsedCents: purchases.stockCents,
    purchaseOrderCents: purchases.purchasedMaterialCents + purchases.outsideCents,
    otherCents,
    laborCents,
    laborHours: job.laborHours ?? 0,
    actualCostCents,
    grossProfitCents: revenueCents - actualCostCents,
    actualMarginPct: actualCostCents > 0 ? marginOf(revenueCents, actualCostCents) : null,
    hasActuals: actualCostCents > 0,
  };
}
