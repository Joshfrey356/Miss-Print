import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activityLogs,
  communications,
  customerContacts,
  customers,
  expenses,
  files,
  invoiceItems,
  invoices,
  jobs,
  payments,
  productCategories,
  users,
  type ExpenseCategory,
  type PaymentMethod,
} from "@/lib/db/schema";
import { addDays, today } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { addMonths, LOW_MARGIN, monthEnd } from "./labels";

// ---------------------------------------------------------------------------
// Shared SQL fragments
// ---------------------------------------------------------------------------
const OPEN = ["sent", "partial"] as const;
export const balanceSql = sql<number>`(case when ${invoices.status} = 'void' then 0 else greatest(${invoices.totalCents} - ${invoices.paidCents}, 0) end)::int`;
const likeEsc = (s: string) => `%${s.replace(/[\\%_]/g, (m) => "\\" + m)}%`;

export const PAGE_SIZE = 50;
const pageOf = (p: string | number | undefined) => Math.max(1, Math.floor(Number(p) || 1));
const isYmd = (s: string | undefined | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isYm = (s: string | undefined | null): s is string => !!s && /^\d{4}-\d{2}$/.test(s);

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
export async function getOverview(tenantId: number) {
  const now = today();
  const ym = now.slice(0, 7);
  const mStart = `${ym}-01`;
  const mEnd = monthEnd(ym);
  const sixStart = `${addMonths(ym, -5)}-01`;
  const { rules } = await getSettings(tenantId);
  const rate = rules.laborCostPerHourCents;

  const jobExp = db
    .select({ jobId: expenses.jobId, cents: sql<number>`sum(${expenses.amountCents})::int`.as("cents") })
    .from(expenses)
    .where(and(eq(expenses.tenantId, tenantId), isNull(expenses.archivedAt), isNotNull(expenses.jobId)))
    .groupBy(expenses.jobId)
    .as("je");

  const [salesRow, cashRow, expRow, arRow, revByMonth, expByMonth, overdue, dueSoon, uninvoiced] = await Promise.all([
    db
      .select({
        sales: sql<number>`coalesce(sum(${invoices.subtotalCents}), 0)::int`,
        count: sql<number>`count(*)::int`,
        jobCost: sql<number>`coalesce(sum(${jobExp.cents}), 0)::int`,
        labor: sql<number>`coalesce(sum(round(coalesce(${jobs.laborHours}, 0) * ${rate})), 0)::int`,
      })
      .from(invoices)
      .leftJoin(jobs, eq(jobs.id, invoices.jobId))
      .leftJoin(jobExp, eq(jobExp.jobId, invoices.jobId))
      .where(and(eq(invoices.tenantId, tenantId), ne(invoices.status, "void"), gte(invoices.issueDate, mStart), lte(invoices.issueDate, mEnd))),
    db
      .select({ cents: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int`, count: sql<number>`count(*)::int` })
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), isNull(payments.voidedAt), gte(payments.receivedOn, mStart), lte(payments.receivedOn, mEnd))),
    db
      .select({ cents: sql<number>`coalesce(sum(${expenses.amountCents}), 0)::int`, count: sql<number>`count(*)::int` })
      .from(expenses)
      .where(and(eq(expenses.tenantId, tenantId), isNull(expenses.archivedAt), gte(expenses.spentOn, mStart), lte(expenses.spentOn, mEnd))),
    db
      .select({
        outstanding: sql<number>`coalesce(sum(${balanceSql}), 0)::int`,
        openCount: sql<number>`count(*)::int`,
        overdue: sql<number>`coalesce(sum(${balanceSql}) filter (where ${invoices.dueDate} < ${now}), 0)::int`,
        overdueCount: sql<number>`(count(*) filter (where ${invoices.dueDate} < ${now}))::int`,
      })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.status, OPEN))),
    db
      .select({ ym: sql<string>`to_char(${invoices.issueDate}, 'YYYY-MM')`, cents: sql<number>`sum(${invoices.subtotalCents})::int` })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), ne(invoices.status, "void"), gte(invoices.issueDate, sixStart)))
      .groupBy(sql`1`),
    db
      .select({ ym: sql<string>`to_char(${expenses.spentOn}, 'YYYY-MM')`, cents: sql<number>`sum(${expenses.amountCents})::int` })
      .from(expenses)
      .where(and(eq(expenses.tenantId, tenantId), isNull(expenses.archivedAt), gte(expenses.spentOn, sixStart)))
      .groupBy(sql`1`),
    openInvoicesQuery(tenantId, and(inArray(invoices.status, OPEN), sql`${invoices.dueDate} < ${now}`))
      .orderBy(asc(invoices.dueDate))
      .limit(8),
    openInvoicesQuery(tenantId, and(inArray(invoices.status, OPEN), gte(invoices.dueDate, now), lte(invoices.dueDate, addDays(now, 7))))
      .orderBy(asc(invoices.dueDate))
      .limit(8),
    getUninvoicedJobs(tenantId),
  ]);

  const months = Array.from({ length: 6 }, (_, i) => {
    const m = addMonths(ym, i - 5);
    return {
      ym: m,
      revenue: revByMonth.find((r) => r.ym === m)?.cents ?? 0,
      expenses: expByMonth.find((r) => r.ym === m)?.cents ?? 0,
    };
  });

  const s = salesRow[0]!;
  return {
    now,
    ym,
    sales: s.sales,
    invoiceCount: s.count,
    grossProfit: s.sales - s.jobCost - s.labor,
    jobCost: s.jobCost,
    laborCost: s.labor,
    cash: cashRow[0]!.cents,
    paymentCount: cashRow[0]!.count,
    expenses: expRow[0]!.cents,
    expenseCount: expRow[0]!.count,
    ...arRow[0]!,
    months,
    overdueList: overdue,
    dueSoonList: dueSoon,
    uninvoiced,
  };
}

function openInvoicesQuery(tenantId: number, where: SQL | undefined) {
  return db
    .select({
      id: invoices.id,
      number: invoices.number,
      dueDate: invoices.dueDate,
      status: invoices.status,
      totalCents: invoices.totalCents,
      balance: balanceSql,
      customerId: invoices.customerId,
      customerName: customers.name,
      jobNumber: jobs.number,
    })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(jobs, eq(jobs.id, invoices.jobId))
    .where(and(eq(invoices.tenantId, tenantId), where))
    .$dynamic();
}

/** Jobs that are done (or about to be handed over) but have no active invoice. */
export async function getUninvoicedJobs(tenantId: number, limit = 20) {
  return db
    .select({
      id: jobs.id,
      number: jobs.number,
      title: jobs.title,
      status: jobs.status,
      totalCents: jobs.totalCents,
      completedAt: jobs.completedAt,
      customerId: jobs.customerId,
      customerName: customers.name,
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(
      and(
        eq(jobs.tenantId, tenantId),
        isNull(jobs.archivedAt),
        inArray(jobs.status, ["completed", "ready_pickup", "scheduled_delivery", "scheduled_install"]),
        sql`(${jobs.status} <> 'completed' or ${jobs.completedAt} >= now() - interval '60 days')`,
        sql`not exists (select 1 from ${invoices} where ${invoices.jobId} = ${jobs.id} and ${invoices.status} <> 'void')`,
      ),
    )
    .orderBy(desc(sql`coalesce(${jobs.completedAt}, ${jobs.updatedAt})`))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------
export const INVOICE_FILTERS = ["unpaid", "overdue", "paid", "void", "all"] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];
export type InvoiceListParams = { q?: string; status?: string; sort?: string; dir?: string; page?: string; from?: string; to?: string };

function invoiceWhere(tenantId: number, p: InvoiceListParams, now = today()) {
  const conds: SQL[] = [eq(invoices.tenantId, tenantId)];
  const status = (INVOICE_FILTERS as readonly string[]).includes(p.status ?? "") ? (p.status as InvoiceFilter) : "all";
  if (status === "unpaid") conds.push(inArray(invoices.status, OPEN));
  if (status === "overdue") conds.push(and(inArray(invoices.status, OPEN), sql`${invoices.dueDate} < ${now}`)!);
  if (status === "paid") conds.push(eq(invoices.status, "paid"));
  if (status === "void") conds.push(eq(invoices.status, "void"));
  if (isYmd(p.from)) conds.push(gte(invoices.issueDate, p.from));
  if (isYmd(p.to)) conds.push(lte(invoices.issueDate, p.to));
  const q = p.q?.trim();
  if (q) {
    const n = q.match(/^(?:inv|mp)?[-\s#]?(\d{3,7})$/i);
    if (n) conds.push(or(eq(invoices.number, Number(n[1])), eq(jobs.number, Number(n[1])))!);
    else conds.push(or(ilike(customers.name, likeEsc(q)), ilike(invoices.poNumber, likeEsc(q)), ilike(jobs.title, likeEsc(q)))!);
  }
  return { where: and(...conds), status };
}

const INVOICE_SORTS = {
  number: invoices.number,
  customer: customers.name,
  issued: invoices.issueDate,
  due: invoices.dueDate,
  total: invoices.totalCents,
  balance: balanceSql,
} as const;

export async function listInvoices(tenantId: number, p: InvoiceListParams, opts: { all?: boolean } = {}) {
  const { where, status } = invoiceWhere(tenantId, p);
  const sortKey = (p.sort && Object.hasOwn(INVOICE_SORTS, p.sort) ? p.sort : "number") as keyof typeof INVOICE_SORTS;
  const dir = p.dir === "asc" ? asc : desc;
  const page = pageOf(p.page);
  const base = db
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      poNumber: invoices.poNumber,
      subtotalCents: invoices.subtotalCents,
      taxCents: invoices.taxCents,
      totalCents: invoices.totalCents,
      paidCents: invoices.paidCents,
      balance: balanceSql,
      customerId: invoices.customerId,
      customerName: customers.name,
      jobNumber: jobs.number,
      jobTitle: jobs.title,
      externalId: invoices.externalId,
    })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(jobs, eq(jobs.id, invoices.jobId))
    .where(where)
    .orderBy(dir(INVOICE_SORTS[sortKey]), desc(invoices.id))
    .$dynamic();
  const rows = opts.all ? await base.limit(20000) : await base.limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE);
  const [agg] = await db
    .select({ total: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${invoices.totalCents}), 0)::int`, balance: sql<number>`coalesce(sum(${balanceSql}), 0)::int` })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(jobs, eq(jobs.id, invoices.jobId))
    .where(where);
  return { rows, total: agg!.total, sumTotal: agg!.sum, sumBalance: agg!.balance, page, status, sort: sortKey, dir: p.dir === "asc" ? "asc" : "desc" };
}

export async function invoiceFilterCounts(tenantId: number, now = today()) {
  const [r] = await db
    .select({
      unpaid: sql<number>`(count(*) filter (where ${invoices.status} in ('sent','partial')))::int`,
      overdue: sql<number>`(count(*) filter (where ${invoices.status} in ('sent','partial') and ${invoices.dueDate} < ${now}))::int`,
    })
    .from(invoices)
    .where(eq(invoices.tenantId, tenantId));
  return r!;
}

export async function getInvoiceDetail(tenantId: number, id: number) {
  const [row] = await db
    .select({
      inv: invoices,
      customer: { id: customers.id, name: customers.name, email: customers.email, phone: customers.phone, address: customers.address, city: customers.city, state: customers.state, zip: customers.zip, billingAddress: customers.billingAddress, paymentTerms: customers.paymentTerms, taxExempt: customers.taxExempt },
      job: { id: jobs.id, number: jobs.number, title: jobs.title, status: jobs.status },
      createdByName: users.name,
    })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(jobs, eq(jobs.id, invoices.jobId))
    .leftJoin(users, eq(users.id, invoices.createdBy))
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)));
  if (!row) return null;
  const [items, pays, reminders, hasContactEmail] = await Promise.all([
    db.select().from(invoiceItems).where(and(eq(invoiceItems.tenantId, tenantId), eq(invoiceItems.invoiceId, id))).orderBy(asc(invoiceItems.sortOrder), asc(invoiceItems.id)),
    db
      .select({ p: payments, recordedByName: users.name })
      .from(payments)
      .leftJoin(users, eq(users.id, payments.recordedBy))
      .where(and(eq(payments.tenantId, tenantId), eq(payments.invoiceId, id)))
      .orderBy(desc(payments.receivedOn), desc(payments.id)),
    db
      .select({ id: communications.id, createdAt: communications.createdAt, toAddress: communications.toAddress, status: communications.status, sentByName: users.name })
      .from(communications)
      .leftJoin(users, eq(users.id, communications.sentBy))
      .where(and(eq(communications.tenantId, tenantId), eq(communications.invoiceId, id), eq(communications.template, "payment_reminder")))
      .orderBy(desc(communications.createdAt)),
    row.customer.email
      ? Promise.resolve(true)
      : db
          .select({ id: customerContacts.id })
          .from(customerContacts)
          .where(and(eq(customerContacts.tenantId, tenantId), eq(customerContacts.customerId, row.customer.id), isNull(customerContacts.archivedAt), isNotNull(customerContacts.email)))
          .limit(1)
          .then((r) => r.length > 0),
  ]);
  const paymentIds = pays.map((x) => x.p.id);
  const activity = await db
    .select({ id: activityLogs.id, action: activityLogs.action, summary: activityLogs.summary, createdAt: activityLogs.createdAt, actorName: users.name })
    .from(activityLogs)
    .leftJoin(users, eq(users.id, activityLogs.actorId))
    .where(
      and(
        eq(activityLogs.tenantId, tenantId),
        or(
          and(eq(activityLogs.entityType, "invoice"), eq(activityLogs.entityId, id)),
          paymentIds.length ? and(eq(activityLogs.entityType, "payment"), inArray(activityLogs.entityId, paymentIds)) : undefined,
        ),
      ),
    )
    .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
    .limit(50);
  return { ...row, items, payments: pays, reminders, activity, hasEmail: hasContactEmail };
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
export type PaymentListParams = { method?: string; from?: string; to?: string; q?: string; page?: string; voided?: string };
const METHODS: PaymentMethod[] = ["cash", "check", "card", "ach", "other"];

export async function listPayments(tenantId: number, p: PaymentListParams, opts: { all?: boolean } = {}) {
  const conds: SQL[] = [eq(payments.tenantId, tenantId)];
  if (p.method && METHODS.includes(p.method as PaymentMethod)) conds.push(eq(payments.method, p.method as PaymentMethod));
  if (isYmd(p.from)) conds.push(gte(payments.receivedOn, p.from));
  if (isYmd(p.to)) conds.push(lte(payments.receivedOn, p.to));
  if (p.voided !== "1") conds.push(isNull(payments.voidedAt));
  const q = p.q?.trim();
  if (q) {
    const n = q.match(/^(?:inv)?[-\s#]?(\d{3,7})$/i);
    conds.push(or(ilike(customers.name, likeEsc(q)), ilike(payments.reference, likeEsc(q)), n ? eq(invoices.number, Number(n[1])) : undefined)!);
  }
  const page = pageOf(p.page);
  const rows = await db
    .select({
      id: payments.id,
      amountCents: payments.amountCents,
      method: payments.method,
      reference: payments.reference,
      receivedOn: payments.receivedOn,
      notes: payments.notes,
      voidedAt: payments.voidedAt,
      invoiceId: invoices.id,
      invoiceNumber: invoices.number,
      customerId: customers.id,
      customerName: customers.name,
      recordedByName: users.name,
    })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .leftJoin(users, eq(users.id, payments.recordedBy))
    .where(and(...conds))
    .orderBy(desc(payments.receivedOn), desc(payments.id))
    .limit(opts.all ? 20000 : PAGE_SIZE)
    .offset(opts.all ? 0 : (page - 1) * PAGE_SIZE);
  const [agg] = await db
    .select({ total: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${payments.amountCents}) filter (where ${payments.voidedAt} is null), 0)::int` })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .where(and(...conds));
  return { rows, total: agg!.total, sum: agg!.sum, page };
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
export type ExpenseListParams = { category?: string; month?: string; attributed?: string; q?: string; page?: string; from?: string; to?: string };

export async function listExpenses(tenantId: number, p: ExpenseListParams, opts: { all?: boolean; categories: readonly ExpenseCategory[] }) {
  const conds: SQL[] = [eq(expenses.tenantId, tenantId), isNull(expenses.archivedAt)];
  if (p.category && opts.categories.includes(p.category as ExpenseCategory)) conds.push(eq(expenses.category, p.category as ExpenseCategory));
  if (isYm(p.month)) conds.push(gte(expenses.spentOn, `${p.month}-01`), lte(expenses.spentOn, monthEnd(p.month)));
  if (isYmd(p.from)) conds.push(gte(expenses.spentOn, p.from));
  if (isYmd(p.to)) conds.push(lte(expenses.spentOn, p.to));
  if (p.attributed === "job") conds.push(isNotNull(expenses.jobId));
  if (p.attributed === "overhead") conds.push(isNull(expenses.jobId));
  const q = p.q?.trim();
  if (q) {
    const n = q.match(/^(?:mp)?[-\s#]?(\d{4,7})$/i);
    conds.push(or(ilike(expenses.vendorName, likeEsc(q)), ilike(expenses.notes, likeEsc(q)), n ? eq(jobs.number, Number(n[1])) : undefined)!);
  }
  const page = pageOf(p.page);
  const base = db
    .select({
      id: expenses.id,
      vendorName: expenses.vendorName,
      amountCents: expenses.amountCents,
      category: expenses.category,
      spentOn: expenses.spentOn,
      paymentMethod: expenses.paymentMethod,
      notes: expenses.notes,
      receiptFileId: expenses.receiptFileId,
      receiptName: files.filename,
      jobId: expenses.jobId,
      jobNumber: jobs.number,
      jobTitle: jobs.title,
      externalId: expenses.externalId,
    })
    .from(expenses)
    .leftJoin(jobs, eq(jobs.id, expenses.jobId))
    .leftJoin(files, eq(files.id, expenses.receiptFileId))
    .where(and(...conds))
    .orderBy(desc(expenses.spentOn), desc(expenses.id))
    .$dynamic();
  const rows = opts.all ? await base.limit(20000) : await base.limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE);
  const [agg] = await db
    .select({ total: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${expenses.amountCents}), 0)::int` })
    .from(expenses)
    .leftJoin(jobs, eq(jobs.id, expenses.jobId))
    .where(and(...conds));
  return { rows, total: agg!.total, sum: agg!.sum, page };
}

export async function getExpense(tenantId: number, id: number) {
  const [row] = await db
    .select({ e: expenses, jobNumber: jobs.number, jobTitle: jobs.title, receiptName: files.filename, createdByName: users.name })
    .from(expenses)
    .leftJoin(jobs, eq(jobs.id, expenses.jobId))
    .leftJoin(files, eq(files.id, expenses.receiptFileId))
    .leftJoin(users, eq(users.id, expenses.createdBy))
    .where(and(eq(expenses.tenantId, tenantId), eq(expenses.id, id), isNull(expenses.archivedAt)));
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Receivables (AR aging)
// ---------------------------------------------------------------------------
export async function getReceivables(tenantId: number) {
  return db
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      totalCents: invoices.totalCents,
      balance: balanceSql,
      lastReminderAt: invoices.lastReminderAt,
      customerId: customers.id,
      customerName: customers.name,
      customerPhone: customers.phone,
      jobNumber: jobs.number,
      hasEmail: sql<boolean>`(${customers.email} is not null or exists (select 1 from ${customerContacts} where ${customerContacts.customerId} = ${customers.id} and ${customerContacts.email} is not null and ${customerContacts.archivedAt} is null))`,
    })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(jobs, eq(jobs.id, invoices.jobId))
    .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.status, OPEN), sql`${invoices.totalCents} > ${invoices.paidCents}`))
    .orderBy(asc(invoices.dueDate), asc(invoices.number))
    .limit(2000);
}

// ---------------------------------------------------------------------------
// Profitability (batch version of src/lib/jobs/profit.ts)
// ---------------------------------------------------------------------------
export type ProfitRow = {
  id: number;
  number: number;
  title: string;
  customerId: number;
  customerName: string;
  categoryName: string | null;
  completedOn: string | null;
  revenue: number;
  quotedRevenue: number;
  estCost: number;
  expenseCost: number;
  laborCost: number;
  actualCost: number;
  quotedMargin: number | null;
  actualMargin: number | null;
};
export type CategoryProfit = { categoryName: string; jobs: number; revenue: number; cost: number; margin: number | null; quotedMargin: number | null; lowCount: number };
export const PROFIT_SORTS = ["margin", "revenue", "profit", "completed", "quoted"] as const;

export async function getProfitability(tenantId: number, p: { from: string; to: string; sort?: string; dir?: string; page?: string; low?: string }) {
  const { rules } = await getSettings(tenantId);
  const rate = rules.laborCostPerHourCents;
  const sort = (PROFIT_SORTS as readonly string[]).includes(p.sort ?? "") ? p.sort! : "margin";
  const dir = p.dir === "desc" ? "desc" : p.dir === "asc" ? "asc" : sort === "margin" ? "asc" : "desc";
  const page = pageOf(p.page);
  const lowOnly = p.low === "1";
  const orderCol = {
    margin: sql`actual_margin`,
    revenue: sql`revenue`,
    profit: sql`(revenue - actual_cost)`,
    completed: sql`completed_on`,
    quoted: sql`quoted_margin`,
  }[sort as (typeof PROFIT_SORTS)[number]];

  const base = sql`
    with je as (
      select job_id, sum(amount_cents)::int as cents from ${expenses}
      where tenant_id = ${tenantId} and archived_at is null and job_id is not null group by job_id
    ), ji as (
      select job_id, sum(subtotal_cents)::int as subtotal from ${invoices}
      where tenant_id = ${tenantId} and status <> 'void' and job_id is not null group by job_id
    ), base as (
      select j.id, j.number, j.title, j.customer_id, c.name as customer_name, pc.name as category_name,
        ((j.completed_at at time zone 'America/Chicago')::date)::text as completed_on,
        coalesce(ji.subtotal, j.subtotal_cents)::int as revenue,
        j.subtotal_cents::int as quoted_revenue,
        j.estimated_cost_cents::int as est_cost,
        coalesce(je.cents, 0)::int as expense_cost,
        round(coalesce(j.labor_hours, 0) * ${rate})::int as labor_cost
      from ${jobs} j
      join ${customers} c on c.id = j.customer_id
      left join ${productCategories} pc on pc.id = j.category_id
      left join je on je.job_id = j.id
      left join ji on ji.job_id = j.id
      where j.tenant_id = ${tenantId} and j.status = 'completed' and j.archived_at is null
        and (j.completed_at at time zone 'America/Chicago')::date between ${p.from}::date and ${p.to}::date
    ), calc as (
      select *, (expense_cost + labor_cost) as actual_cost,
        case when quoted_revenue > 0 then (quoted_revenue - est_cost)::float8 / quoted_revenue end as quoted_margin,
        case when revenue > 0 and (expense_cost + labor_cost) > 0 then (revenue - expense_cost - labor_cost)::float8 / revenue end as actual_margin
      from base
    )`;

  const lowSql = lowOnly ? sql`where actual_margin < ${LOW_MARGIN}` : sql``;
  const [rows, [summary], cats] = await Promise.all([
    db.execute(sql`${base}
      select id, number, title, customer_id as "customerId", customer_name as "customerName", category_name as "categoryName",
        completed_on as "completedOn", revenue, quoted_revenue as "quotedRevenue", est_cost as "estCost",
        expense_cost as "expenseCost", labor_cost as "laborCost", actual_cost as "actualCost",
        quoted_margin as "quotedMargin", actual_margin as "actualMargin"
      from calc ${lowSql}
      order by ${orderCol} ${dir === "asc" ? sql`asc` : sql`desc`} nulls last, number desc
      limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`) as unknown as Promise<ProfitRow[]>,
    db.execute(sql`${base}
      select count(*)::int as jobs,
        (count(*) filter (where actual_margin < ${LOW_MARGIN}))::int as "lowCount",
        (count(*) filter (where actual_cost = 0))::int as "noCostCount",
        coalesce(sum(revenue), 0)::int as revenue,
        coalesce(sum(actual_cost), 0)::int as cost,
        coalesce(sum(est_cost), 0)::int as "estCost",
        coalesce(sum(quoted_revenue), 0)::int as "quotedRevenue",
        (count(*) filter (where ${lowOnly ? sql`actual_margin < ${LOW_MARGIN}` : sql`true`}))::int as "filtered"
      from calc`) as unknown as Promise<{ jobs: number; lowCount: number; noCostCount: number; revenue: number; cost: number; estCost: number; quotedRevenue: number; filtered: number }[]>,
    db.execute(sql`${base}
      select coalesce(category_name, 'Uncategorized') as "categoryName", count(*)::int as jobs,
        coalesce(sum(revenue), 0)::int as revenue, coalesce(sum(actual_cost), 0)::int as cost,
        case when sum(revenue) filter (where actual_cost > 0) > 0
          then (sum(revenue - actual_cost) filter (where actual_cost > 0))::float8 / sum(revenue) filter (where actual_cost > 0) end as margin,
        case when sum(quoted_revenue) > 0 then (sum(quoted_revenue - est_cost))::float8 / sum(quoted_revenue) end as "quotedMargin",
        (count(*) filter (where actual_margin < ${LOW_MARGIN}))::int as "lowCount"
      from calc group by 1 order by margin asc nulls last, revenue desc`) as unknown as Promise<CategoryProfit[]>,
  ]);
  return { rows: [...rows], summary: summary!, categories: [...cats], page, sort, dir, rate };
}
