import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { WORK_STATUSES } from "@/lib/jobs/workflow";
import { SHOP_TZ, today } from "@/lib/format";
import { jobPurchaseCostsSql } from "@/lib/inventory/cost-sql";
import type { JobStatus } from "@/lib/db/schema";

/**
 * Report queries. Every function takes an inclusive date range (YYYY-MM-DD, shop time).
 * Revenue = invoice subtotals (before sales tax) by issue date, excluding void invoices.
 * Actual cost = job expenses + labor hours × business_rules.laborCostPerHourCents.
 * Every function takes the shop (tenantId) first; each root table filters `tenant_id` by hand, since
 * the tenant-scope test can't see inside raw SQL.
 */
export type Range = { from: string; to: string };

async function rows<T>(q: SQL): Promise<T[]> {
  return (await db.execute(q)) as unknown as T[];
}

const tz = sql.raw(`'${SHOP_TZ}'`);
const shopDate = (col: SQL) => sql`((${col}) at time zone ${tz})::date`;
const statusList = (list: JobStatus[]) => sql.join(list.map((s) => sql`${s}::job_status`), sql`, `);

const invoicesInRange = (tenantId: number, r: Range) => sql`i.tenant_id = ${tenantId} and i.status <> 'void' and i.issue_date between ${r.from}::date and ${r.to}::date`;

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------
export type Bucket = { label: string; cents: number; count: number; id?: number | null };

export async function revenueTotals(tenantId: number, r: Range) {
  const [row] = await rows<{ cents: number; invoices: number; customers: number }>(sql`
    select coalesce(sum(i.subtotal_cents), 0)::int as cents, count(*)::int as invoices, count(distinct i.customer_id)::int as customers
    from invoices i where ${invoicesInRange(tenantId, r)}`);
  return row ?? { cents: 0, invoices: 0, customers: 0 };
}

export function revenueByMonth(tenantId: number, r: Range) {
  return rows<{ month: string; cents: number; count: number }>(sql`
    select to_char(date_trunc('month', i.issue_date), 'YYYY-MM') as month, sum(i.subtotal_cents)::int as cents, count(*)::int as count
    from invoices i where ${invoicesInRange(tenantId, r)}
    group by 1 order by 1`);
}

export function revenueByCategory(tenantId: number, r: Range) {
  return rows<Bucket>(sql`
    select coalesce(pc.name, 'No product category') as label, pc.id as id, sum(i.subtotal_cents)::int as cents, count(*)::int as count
    from invoices i
    left join jobs j on j.id = i.job_id
    left join product_categories pc on pc.id = j.category_id
    where ${invoicesInRange(tenantId, r)}
    group by pc.id, pc.name order by cents desc`);
}

export function revenueByCustomer(tenantId: number, r: Range, limit = 10) {
  return rows<Bucket>(sql`
    select c.name as label, c.id as id, sum(i.subtotal_cents)::int as cents, count(*)::int as count
    from invoices i join customers c on c.id = i.customer_id
    where ${invoicesInRange(tenantId, r)}
    group by c.id, c.name order by cents desc limit ${limit}`);
}

export function revenueBySalesperson(tenantId: number, r: Range) {
  return rows<Bucket>(sql`
    select coalesce(u.name, 'No salesperson') as label, u.id as id, sum(i.subtotal_cents)::int as cents, count(*)::int as count
    from invoices i
    join customers c on c.id = i.customer_id
    left join jobs j on j.id = i.job_id
    left join users u on u.id = coalesce(j.salesperson_id, c.salesperson_id)
    where ${invoicesInRange(tenantId, r)}
    group by u.id, u.name order by cents desc`);
}

/** Location where the work is made: the category's usual location, else the job's current location. */
export function revenueByLocation(tenantId: number, r: Range) {
  return rows<Bucket>(sql`
    select coalesce(l.name, 'Not set') as label, l.id as id, sum(i.subtotal_cents)::int as cents, count(*)::int as count
    from invoices i
    left join jobs j on j.id = i.job_id
    left join product_categories pc on pc.id = j.category_id
    left join locations l on l.id = coalesce(pc.default_location_id, j.location_id)
    where ${invoicesInRange(tenantId, r)}
    group by l.id, l.name order by cents desc`);
}

// ---------------------------------------------------------------------------
// Profitability (per job with an invoice in range)
// ---------------------------------------------------------------------------
export type JobProfit = {
  id: number;
  number: number;
  title: string;
  customerId: number;
  customer: string;
  category: string;
  revenueCents: number;
  expenseCents: number;
  /** Purchase orders charged to the job + stock used on it (src/lib/inventory/cost-sql.ts). */
  purchaseCents: number;
  laborCents: number;
  costCents: number;
};

export function jobProfits(tenantId: number, r: Range, laborRateCents: number) {
  return rows<JobProfit>(sql`
    with rev as (
      select i.job_id, sum(i.subtotal_cents)::int as revenue
      from invoices i where ${invoicesInRange(tenantId, r)} and i.job_id is not null
      group by i.job_id
    ), ex as (
      select e.job_id, sum(e.amount_cents)::int as cents
      from expenses e where e.tenant_id = ${tenantId} and e.archived_at is null and e.job_id in (select job_id from rev)
      group by e.job_id
    ), po as (
      ${jobPurchaseCostsSql(tenantId, (col) => sql`${col} in (select job_id from rev)`)}
    ), pcost as (
      select job_id, (stock_cents + purchased_material_cents + po_outside_cents)::int as cents from po
    )
    select j.id, j.number, j.title, c.id as "customerId", c.name as customer,
      coalesce(pc.name, 'No product category') as category,
      rev.revenue as "revenueCents",
      coalesce(ex.cents, 0)::int as "expenseCents",
      coalesce(pcost.cents, 0)::int as "purchaseCents",
      round(j.labor_hours * ${laborRateCents})::int as "laborCents",
      (coalesce(ex.cents, 0) + coalesce(pcost.cents, 0) + round(j.labor_hours * ${laborRateCents}))::int as "costCents"
    from rev
    join jobs j on j.id = rev.job_id
    join customers c on c.id = j.customer_id
    left join product_categories pc on pc.id = j.category_id
    left join ex on ex.job_id = j.id
    left join pcost on pcost.job_id = j.id`);
}

/** Revenue on invoices that aren't linked to a job (no cost is known for these). */
export async function unlinkedRevenue(tenantId: number, r: Range) {
  const [row] = await rows<{ cents: number; count: number }>(sql`
    select coalesce(sum(i.subtotal_cents), 0)::int as cents, count(*)::int as count
    from invoices i where ${invoicesInRange(tenantId, r)} and i.job_id is null`);
  return row ?? { cents: 0, count: 0 };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
const completedInRange = (tenantId: number, r: Range) =>
  sql`j.tenant_id = ${tenantId} and j.status = 'completed' and j.completed_at is not null and j.archived_at is null and ${shopDate(sql`j.completed_at`)} between ${r.from}::date and ${r.to}::date`;

export function jobsCompletedByMonth(tenantId: number, r: Range) {
  return rows<{ month: string; count: number }>(sql`
    select to_char(date_trunc('month', ${shopDate(sql`j.completed_at`)}), 'YYYY-MM') as month, count(*)::int as count
    from jobs j where ${completedInRange(tenantId, r)}
    group by 1 order by 1`);
}

export async function completionSummary(tenantId: number, r: Range) {
  const [row] = await rows<{ completed: number; avgDays: number | null; withDue: number; onTime: number }>(sql`
    select count(*)::int as completed,
      avg(${shopDate(sql`j.completed_at`)} - ${shopDate(sql`j.created_at`)})::float8 as "avgDays",
      count(j.due_date)::int as "withDue",
      count(*) filter (where j.due_date is not null and ${shopDate(sql`j.completed_at`)} <= j.due_date)::int as "onTime"
    from jobs j where ${completedInRange(tenantId, r)}`);
  return row ?? { completed: 0, avgDays: null, withDue: 0, onTime: 0 };
}

export function turnaroundByCategory(tenantId: number, r: Range) {
  return rows<{ label: string; count: number; avgDays: number; onTime: number; withDue: number }>(sql`
    select coalesce(pc.name, 'No product category') as label, count(*)::int as count,
      avg(${shopDate(sql`j.completed_at`)} - ${shopDate(sql`j.created_at`)})::float8 as "avgDays",
      count(j.due_date)::int as "withDue",
      count(*) filter (where j.due_date is not null and ${shopDate(sql`j.completed_at`)} <= j.due_date)::int as "onTime"
    from jobs j left join product_categories pc on pc.id = j.category_id
    where ${completedInRange(tenantId, r)}
    group by pc.id, pc.name order by count desc`);
}

export type OverdueJob = { id: number; number: number; title: string; customer: string; customerId: number; dueDate: string; status: JobStatus; daysLate: number };

/** Jobs past their due date that still have work to do. Not tied to the date range. */
export async function overdueJobs(tenantId: number, limit = 15) {
  const t = today();
  const where = sql`j.tenant_id = ${tenantId} and j.archived_at is null and j.due_date < ${t}::date and j.status in (${statusList(WORK_STATUSES)})`;
  const [list, [c]] = await Promise.all([
    rows<OverdueJob>(sql`
      select j.id, j.number, j.title, c.name as customer, c.id as "customerId", to_char(j.due_date, 'YYYY-MM-DD') as "dueDate", j.status,
        (${t}::date - j.due_date)::int as "daysLate"
      from jobs j join customers c on c.id = j.customer_id
      where ${where} order by j.due_date asc limit ${limit}`),
    rows<{ n: number }>(sql`select count(*)::int as n from jobs j where ${where}`),
  ]);
  return { count: c?.n ?? 0, list };
}

export type WaitingProof = { id: number; jobNumber: number; title: string; customer: string; version: number; sentAt: string; days: number; sentTo: string | null };

/** Proofs sent to the customer and not answered yet. Not tied to the date range. */
export function outstandingProofs(tenantId: number) {
  return rows<WaitingProof>(sql`
    select p.id, j.number as "jobNumber", j.title, c.name as customer, p.version, p.sent_to as "sentTo",
      to_char(${shopDate(sql`coalesce(p.sent_at, p.created_at)`)}, 'YYYY-MM-DD') as "sentAt",
      (${today()}::date - ${shopDate(sql`coalesce(p.sent_at, p.created_at)`)})::int as days
    from proofs p join jobs j on j.id = p.job_id join customers c on c.id = j.customer_id
    where p.tenant_id = ${tenantId} and p.status = 'sent' and j.archived_at is null
    order by coalesce(p.sent_at, p.created_at) asc`);
}

// ---------------------------------------------------------------------------
// Sales (quotes created in range)
// ---------------------------------------------------------------------------
const quotesInRange = (tenantId: number, r: Range) =>
  sql`q.tenant_id = ${tenantId} and q.archived_at is null and ${shopDate(sql`q.created_at`)} between ${r.from}::date and ${r.to}::date`;

export async function quoteSummary(tenantId: number, r: Range) {
  const [row] = await rows<{
    total: number;
    won: number;
    lost: number;
    open: number;
    wonCents: number;
    lostCents: number;
  }>(sql`
    select count(*)::int as total,
      count(*) filter (where q.status in ('accepted', 'converted'))::int as won,
      count(*) filter (where q.status in ('declined', 'expired'))::int as lost,
      count(*) filter (where q.status in ('draft', 'sent'))::int as open,
      coalesce(sum(q.subtotal_cents) filter (where q.status in ('accepted', 'converted')), 0)::int as "wonCents",
      coalesce(sum(q.subtotal_cents) filter (where q.status in ('declined', 'expired')), 0)::int as "lostCents"
    from quotes q where ${quotesInRange(tenantId, r)}`);
  const s = row ?? { total: 0, won: 0, lost: 0, open: 0, wonCents: 0, lostCents: 0 };
  return { ...s, winRate: s.won + s.lost > 0 ? s.won / (s.won + s.lost) : null };
}

/** Quotes waiting on an answer right now (any date). */
export async function openQuotesNow(tenantId: number) {
  const [row] = await rows<{ sent: number; draft: number; sentCents: number; draftCents: number; oldSent: number }>(sql`
    select count(*) filter (where q.status = 'sent')::int as sent,
      count(*) filter (where q.status = 'draft')::int as draft,
      coalesce(sum(q.subtotal_cents) filter (where q.status = 'sent'), 0)::int as "sentCents",
      coalesce(sum(q.subtotal_cents) filter (where q.status = 'draft'), 0)::int as "draftCents",
      count(*) filter (where q.status = 'sent' and q.sent_at < now() - interval '7 days')::int as "oldSent"
    from quotes q where q.tenant_id = ${tenantId} and q.archived_at is null and q.status in ('draft', 'sent')`);
  return row ?? { sent: 0, draft: 0, sentCents: 0, draftCents: 0, oldSent: 0 };
}

export function lostReasons(tenantId: number, r: Range) {
  return rows<{ label: string; count: number; cents: number }>(sql`
    select coalesce(nullif(trim(q.lost_reason), ''), case when q.status = 'expired' then 'Expired — no answer' else 'No reason given' end) as label,
      count(*)::int as count, coalesce(sum(q.subtotal_cents), 0)::int as cents
    from quotes q where ${quotesInRange(tenantId, r)} and q.status in ('declined', 'expired')
    group by 1 order by count desc, label`);
}

export function quotesBySalesperson(tenantId: number, r: Range) {
  return rows<{ label: string; total: number; won: number; lost: number; wonCents: number }>(sql`
    select coalesce(u.name, 'No salesperson') as label, count(*)::int as total,
      count(*) filter (where q.status in ('accepted', 'converted'))::int as won,
      count(*) filter (where q.status in ('declined', 'expired'))::int as lost,
      coalesce(sum(q.subtotal_cents) filter (where q.status in ('accepted', 'converted')), 0)::int as "wonCents"
    from quotes q left join users u on u.id = q.salesperson_id
    where ${quotesInRange(tenantId, r)}
    group by u.id, u.name order by total desc`);
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export function topCustomers(tenantId: number, r: Range, byRevenue: boolean, limit = 15) {
  return rows<{ id: number; name: string; jobs: number; cents: number }>(sql`
    with j as (
      select j.customer_id, count(*)::int as jobs from jobs j
      where j.tenant_id = ${tenantId} and j.archived_at is null and ${shopDate(sql`j.created_at`)} between ${r.from}::date and ${r.to}::date
      group by j.customer_id
    ), i as (
      select i.customer_id, sum(i.subtotal_cents)::int as cents from invoices i where ${invoicesInRange(tenantId, r)} group by i.customer_id
    )
    select c.id, c.name, coalesce(j.jobs, 0)::int as jobs, coalesce(i.cents, 0)::int as cents
    from customers c left join j on j.customer_id = c.id left join i on i.customer_id = c.id
    where c.tenant_id = ${tenantId} and (coalesce(j.jobs, 0) > 0 or coalesce(i.cents, 0) > 0)
    order by ${byRevenue ? sql`cents desc, jobs desc` : sql`jobs desc, c.name`} limit ${limit}`);
}

export type InactiveCustomer = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  lastOrder: string;
  jobs: number;
  lifetimeCents: number;
};

/** Ordered before, but no new job in the last 6 months. Most valuable first. */
export function inactiveCustomers(tenantId: number, limit = 25) {
  return rows<InactiveCustomer>(sql`
    select c.id, c.name, c.phone, c.email,
      to_char(max(${shopDate(sql`j.created_at`)}), 'YYYY-MM-DD') as "lastOrder",
      count(j.id)::int as jobs,
      coalesce((select sum(i.subtotal_cents) from invoices i where i.customer_id = c.id and i.status <> 'void'), 0)::int as "lifetimeCents"
    from customers c join jobs j on j.customer_id = c.id and j.archived_at is null
    where c.tenant_id = ${tenantId} and c.archived_at is null
    group by c.id
    having max(j.created_at) < now() - interval '6 months'
    order by "lifetimeCents" desc, jobs desc limit ${limit}`);
}

export async function repeatCustomers(tenantId: number, r: Range) {
  const [row] = await rows<{ customers: number; repeat: number }>(sql`
    select count(*)::int as customers, count(*) filter (where n >= 2)::int as repeat
    from (
      select j.customer_id, count(*) as n from jobs j
      where j.tenant_id = ${tenantId} and j.archived_at is null and ${shopDate(sql`j.created_at`)} between ${r.from}::date and ${r.to}::date
      group by j.customer_id
    ) t`);
  const s = row ?? { customers: 0, repeat: 0 };
  return { ...s, pct: s.customers ? s.repeat / s.customers : null };
}
