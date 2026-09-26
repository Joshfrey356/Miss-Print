import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { expenses, jobs, vendors, type ExpenseCategory } from "@/lib/db/schema";
import { diff, logActivity } from "@/lib/activity";
import { jobNo, money, parseJobNumber } from "@/lib/format";
import { UserError } from "@/lib/actions";
import { EXPENSE_CATEGORY_LABELS } from "./labels";

type Actor = { id: number; name: string };

export type ExpenseInput = {
  vendorName: string;
  amountCents: number;
  category: ExpenseCategory;
  spentOn: string;
  jobId: number | null;
  paymentMethod: string | null;
  notes: string | null;
  receiptFileId?: number | null;
};

export const getVendorNames = () =>
  db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(isNull(vendors.archivedAt)).orderBy(asc(vendors.name));

/** Match a typed vendor name to a vendor record (case-insensitive). */
async function vendorFor(name: string) {
  const [v] = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .where(and(isNull(vendors.archivedAt), sql`lower(${vendors.name}) = ${name.trim().toLowerCase()}`))
    .limit(1);
  return v ?? null;
}

/** "MP-10428" / "10428" → job, or throws a friendly error. Blank → null. */
export async function jobFromNumberInput(input: string | null) {
  if (!input?.trim()) return null;
  const n = parseJobNumber(input);
  if (n == null) throw new UserError(`"${input}" isn't a job number. Use a number like MP-10428.`);
  const [job] = await db.select({ id: jobs.id, number: jobs.number, title: jobs.title, customerId: jobs.customerId }).from(jobs).where(eq(jobs.number, n));
  if (!job) throw new UserError(`Job ${jobNo(n)} wasn't found.`);
  return job;
}

export async function createExpense(input: ExpenseInput, actor: Actor) {
  const vendor = await vendorFor(input.vendorName);
  const vendorName = vendor?.name ?? input.vendorName.trim();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(expenses)
      .values({ ...input, vendorName, vendorId: vendor?.id ?? null, receiptFileId: input.receiptFileId ?? null, createdBy: actor.id })
      .returning();
    const [job] = input.jobId ? await tx.select({ number: jobs.number, customerId: jobs.customerId }).from(jobs).where(eq(jobs.id, input.jobId)) : [];
    await logActivity(
      {
        action: "expense.created",
        entityType: "expense",
        entityId: row!.id,
        jobId: input.jobId,
        customerId: job?.customerId ?? null,
        actorId: actor.id,
        summary: `Added expense: ${money(input.amountCents)} ${EXPENSE_CATEGORY_LABELS[input.category].toLowerCase()} from ${vendorName}${job ? ` for ${jobNo(job.number)}` : ""}`,
      },
      tx,
    );
    return row!;
  });
}

export async function updateExpense(id: number, input: ExpenseInput, actor: Actor) {
  const [before] = await db.select().from(expenses).where(and(eq(expenses.id, id), isNull(expenses.archivedAt)));
  if (!before) throw new UserError("Expense not found.");
  const vendor = await vendorFor(input.vendorName);
  const next = {
    vendorName: vendor?.name ?? input.vendorName.trim(),
    vendorId: vendor?.id ?? null,
    amountCents: input.amountCents,
    category: input.category,
    spentOn: input.spentOn,
    jobId: input.jobId,
    paymentMethod: input.paymentMethod,
    notes: input.notes,
    ...(input.receiptFileId !== undefined ? { receiptFileId: input.receiptFileId } : {}),
  };
  const changes = diff(before as unknown as Record<string, unknown>, next);
  if (!changes) return before;
  return db.transaction(async (tx) => {
    const [row] = await tx.update(expenses).set(next).where(eq(expenses.id, id)).returning();
    await logActivity(
      {
        action: "expense.updated",
        entityType: "expense",
        entityId: id,
        jobId: input.jobId ?? before.jobId,
        actorId: actor.id,
        summary: `Updated expense from ${next.vendorName} (${money(next.amountCents)})`,
        data: changes,
      },
      tx,
    );
    return row!;
  });
}

export async function archiveExpense(id: number, actor: Actor) {
  const [e] = await db.select().from(expenses).where(and(eq(expenses.id, id), isNull(expenses.archivedAt)));
  if (!e) throw new UserError("Expense not found.");
  await db.transaction(async (tx) => {
    await tx.update(expenses).set({ archivedAt: new Date() }).where(eq(expenses.id, id));
    await logActivity(
      { action: "expense.archived", entityType: "expense", entityId: id, jobId: e.jobId, actorId: actor.id, summary: `Removed expense: ${money(e.amountCents)} from ${e.vendorName} (${e.spentOn})` },
      tx,
    );
  });
  return e;
}

/** Vendor names for the quick-entry datalist, with the category last used for each (so it can be pre-picked). */
export async function getVendorSuggestions() {
  const [known, recent] = await Promise.all([
    getVendorNames(),
    db.execute(sql`
      select * from (
        select distinct on (lower(vendor_name)) vendor_name as name, category::text as category, spent_on::text as last
        from ${expenses} where archived_at is null
        order by lower(vendor_name), spent_on desc, id desc
      ) v order by last desc limit 300`) as unknown as Promise<{ name: string; category: ExpenseCategory; last: string }[]>,
  ]);
  const map = new Map<string, { name: string; category: ExpenseCategory | null }>();
  for (const r of recent) map.set(r.name.toLowerCase(), { name: r.name, category: r.category });
  for (const v of known) if (!map.has(v.name.toLowerCase())) map.set(v.name.toLowerCase(), { name: v.name, category: null });
  return [...map.values()];
}
