import "server-only";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { expenses, invoices, jobs } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";
import { marginOf } from "@/lib/pricing/engine";

const MATERIAL = ["materials", "ink_toner", "paper", "vinyl", "substrates"];
const OUTSIDE = ["outside_services", "installation", "shipping"];

/** Quoted vs actual profitability for one job. Actual cost = attached expenses + labor hours × labor cost. */
export async function getJobProfitability(jobId: number) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) return null;
  const { rules } = await getSettings();
  const rows = await db
    .select({ category: expenses.category, cents: sql<number>`sum(${expenses.amountCents})::int` })
    .from(expenses)
    .where(and(eq(expenses.jobId, jobId), isNull(expenses.archivedAt)))
    .groupBy(expenses.category);
  const sum = (cats: string[]) => rows.filter((r) => cats.includes(r.category)).reduce((a, r) => a + r.cents, 0);
  const materialCents = sum(MATERIAL);
  const outsideCents = sum(OUTSIDE);
  const otherCents = rows.reduce((a, r) => a + r.cents, 0) - materialCents - outsideCents;
  const laborCents = Math.round((job.laborHours ?? 0) * rules.laborCostPerHourCents);
  const actualCostCents = materialCents + outsideCents + otherCents + laborCents;
  const [inv] = await db
    .select({ subtotal: invoices.subtotalCents })
    .from(invoices)
    .where(and(eq(invoices.jobId, jobId), ne(invoices.status, "void")));
  const revenueCents = inv?.subtotal ?? job.subtotalCents; // revenue excludes sales tax
  return {
    revenueCents,
    quotedCostCents: job.estimatedCostCents,
    quotedMarginPct: marginOf(job.subtotalCents, job.estimatedCostCents),
    materialCents,
    outsideCents,
    otherCents,
    laborCents,
    laborHours: job.laborHours ?? 0,
    actualCostCents,
    grossProfitCents: revenueCents - actualCostCents,
    actualMarginPct: actualCostCents > 0 ? marginOf(revenueCents, actualCostCents) : null,
    hasActuals: actualCostCents > 0,
  };
}
