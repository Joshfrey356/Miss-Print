import "server-only";
import { cache } from "react";
import type { Role } from "@/lib/db/schema";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { STATUS_LABELS } from "@/lib/jobs/workflow";
import { marginOf } from "@/lib/pricing/engine";
import { jobNo } from "@/lib/format";
import * as q from "./queries";
import { monthLabel, monthsBetween, type DateRange } from "./range";

/**
 * Every report table in one place, so the page and the CSV download show the same numbers
 * and apply the same permission rules.
 */
export type ColKind = "text" | "money" | "int" | "pct" | "days" | "date";
export type Column = {
  key: string;
  label: string;
  kind: ColKind;
  /** Money column inside a non-money report: dropped for people who can't see money. */
  money?: boolean;
  /** Row field that holds a link for this cell. */
  href?: string;
  /** Hide on small screens. */
  wide?: boolean;
};
export type Row = Record<string, string | number | null>;
export type ReportTable = { columns: Column[]; rows: Row[]; note?: string };
export type Access = "basic" | "financial" | "margins";
export type TabKey = "revenue" | "profit" | "operations" | "sales" | "customers";
export type ReportCtx = { tenantId: number; financial: boolean; margins: boolean; laborRateCents: number; targetMarginPct: number };

/** What this person may see in Reports. Money needs reports.financial or margins.view; costs need margins.view. */
export async function getReportCtx(tenantId: number, role: Role): Promise<ReportCtx> {
  const { rules } = await getSettings(tenantId);
  return {
    tenantId,
    financial: can(role, "reports.financial") || can(role, "margins.view"),
    margins: can(role, "margins.view"),
    laborRateCents: rules.laborCostPerHourCents,
    targetMarginPct: rules.targetMarginPct,
  };
}

/** Several profit reports share one query per request. */
export const jobProfitsFor = cache((tenantId: number, from: string, to: string, laborRateCents: number) => q.jobProfits(tenantId, { from, to }, laborRateCents));

export type ReportDef = {
  title: string;
  description: string;
  tab: TabKey;
  access: Access;
  /** Numeric column drawn as a bar next to the value. */
  bar?: string;
  /** Draw a month-by-month column chart above the table. */
  monthly?: { valueKey: string };
  empty: string;
  build: (r: DateRange, ctx: ReportCtx) => Promise<ReportTable>;
};

const share = (part: number, total: number) => (total > 0 ? part / total : null);

function bucketTable(label: string, list: q.Bucket[], href?: (b: q.Bucket) => string | null): ReportTable {
  const total = list.reduce((s, b) => s + b.cents, 0);
  return {
    columns: [
      { key: "label", label, kind: "text", href: href ? "href" : undefined },
      { key: "cents", label: "Revenue", kind: "money" },
      { key: "share", label: "Share", kind: "pct", wide: true },
      { key: "count", label: "Invoices", kind: "int", wide: true },
    ],
    rows: list.map((b) => ({ label: b.label, cents: b.cents, share: share(b.cents, total), count: b.count, href: href?.(b) ?? null })),
  };
}

function profitGroups(list: q.JobProfit[], keyOf: (j: q.JobProfit) => string, hrefOf?: (j: q.JobProfit) => string) {
  const map = new Map<string, { label: string; jobs: number; revenue: number; cost: number; href: string | null; noCost: number }>();
  for (const j of list) {
    const k = keyOf(j);
    const g = map.get(k) ?? { label: k, jobs: 0, revenue: 0, cost: 0, href: hrefOf?.(j) ?? null, noCost: 0 };
    g.jobs++;
    g.revenue += j.revenueCents;
    g.cost += j.costCents;
    if (j.costCents === 0) g.noCost++;
    map.set(k, g);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

const profitColumns = (label: string, withHref: boolean): Column[] => [
  { key: "label", label, kind: "text", href: withHref ? "href" : undefined },
  { key: "jobs", label: "Jobs", kind: "int", wide: true },
  { key: "revenue", label: "Revenue", kind: "money" },
  { key: "cost", label: "Actual cost", kind: "money", wide: true },
  { key: "profit", label: "Gross profit", kind: "money" },
  { key: "margin", label: "Margin", kind: "pct" },
];

function noCostNote(list: q.JobProfit[]) {
  const n = list.filter((j) => j.costCents === 0).length;
  return n ? `${n} job${n === 1 ? " has" : "s have"} no costs or labor hours recorded, so their margin looks better than it really is.` : undefined;
}

export const REPORTS = {
  // ---------------------------------------------------------------- Revenue
  revenue_month: {
    title: "Revenue by month",
    description: "Invoice totals before sales tax, by the date the invoice was issued. Voided invoices are left out.",
    tab: "revenue",
    access: "financial",
    monthly: { valueKey: "cents" },
    empty: "No invoices in this period.",
    async build(r, ctx) {
      const data = await q.revenueByMonth(ctx.tenantId, r);
      const by = new Map(data.map((d) => [d.month, d]));
      return {
        columns: [
          { key: "label", label: "Month", kind: "text" },
          { key: "cents", label: "Revenue", kind: "money" },
          { key: "count", label: "Invoices", kind: "int" },
        ],
        rows: monthsBetween(r.from, r.to).map((m) => ({ month: m, label: monthLabel(m, true), cents: by.get(m)?.cents ?? 0, count: by.get(m)?.count ?? 0 })),
      };
    },
  },
  revenue_category: {
    title: "Revenue by product",
    description: "Which kinds of work bring in the money.",
    tab: "revenue",
    access: "financial",
    bar: "cents",
    empty: "No invoices in this period.",
    build: async (r, ctx) => bucketTable("Product category", await q.revenueByCategory(ctx.tenantId, r)),
  },
  revenue_customer: {
    title: "Top 10 customers",
    description: "The customers who were billed the most in this period.",
    tab: "revenue",
    access: "financial",
    bar: "cents",
    empty: "No invoices in this period.",
    build: async (r, ctx) => bucketTable("Customer", await q.revenueByCustomer(ctx.tenantId, r), (b) => `/customers/${b.id}`),
  },
  revenue_salesperson: {
    title: "Revenue by salesperson",
    description: "Uses the salesperson on the job, or the customer's salesperson when the job has none.",
    tab: "revenue",
    access: "financial",
    bar: "cents",
    empty: "No invoices in this period.",
    build: async (r, ctx) => bucketTable("Salesperson", await q.revenueBySalesperson(ctx.tenantId, r)),
  },
  revenue_location: {
    title: "Revenue by location",
    description: "Where the work is made (the product category's usual location).",
    tab: "revenue",
    access: "financial",
    bar: "cents",
    empty: "No invoices in this period.",
    build: async (r, ctx) => bucketTable("Location", await q.revenueByLocation(ctx.tenantId, r)),
  },

  // ---------------------------------------------------------------- Profit
  profit_category: {
    title: "Profit by product",
    description: "Actual cost = expenses attached to the job + labor hours × your labor cost per hour.",
    tab: "profit",
    access: "margins",
    empty: "No invoiced jobs in this period.",
    async build(r, ctx) {
      const list = await jobProfitsFor(ctx.tenantId, r.from, r.to, ctx.laborRateCents);
      return {
        columns: profitColumns("Product category", false),
        rows: profitGroups(list, (j) => j.category).map((g) => ({ ...g, profit: g.revenue - g.cost, margin: marginOf(g.revenue, g.cost) })),
        note: noCostNote(list),
      };
    },
  },
  profit_customer: {
    title: "Profit by customer",
    description: "Your 15 biggest customers in this period, and how much you actually keep from each.",
    tab: "profit",
    access: "margins",
    empty: "No invoiced jobs in this period.",
    async build(r, ctx) {
      const list = await jobProfitsFor(ctx.tenantId, r.from, r.to, ctx.laborRateCents);
      return {
        columns: profitColumns("Customer", true),
        rows: profitGroups(list, (j) => j.customer, (j) => `/customers/${j.customerId}`)
          .slice(0, 15)
          .map((g) => ({ ...g, profit: g.revenue - g.cost, margin: marginOf(g.revenue, g.cost) })),
      };
    },
  },
  profit_lowest: {
    title: "Lowest-margin jobs",
    description: "The 15 jobs that kept the least. Worth a look: was it priced too low, or did it cost more than planned?",
    tab: "profit",
    access: "margins",
    empty: "No invoiced jobs with costs recorded in this period.",
    async build(r, ctx) {
      const list = (await jobProfitsFor(ctx.tenantId, r.from, r.to, ctx.laborRateCents))
        .filter((j) => j.costCents > 0 && j.revenueCents > 0)
        .map((j) => ({ ...j, margin: marginOf(j.revenueCents, j.costCents) ?? 0 }))
        .sort((a, b) => a.margin - b.margin)
        .slice(0, 15);
      return {
        columns: [
          { key: "job", label: "Job", kind: "text", href: "href" },
          { key: "title", label: "What", kind: "text", wide: true },
          { key: "customer", label: "Customer", kind: "text", wide: true },
          { key: "revenue", label: "Revenue", kind: "money" },
          { key: "cost", label: "Actual cost", kind: "money", wide: true },
          { key: "margin", label: "Margin", kind: "pct" },
        ],
        rows: list.map((j) => ({
          job: jobNo(j.number),
          href: `/jobs/${j.number}`,
          title: j.title,
          customer: j.customer,
          revenue: j.revenueCents,
          cost: j.costCents,
          margin: j.margin,
        })),
      };
    },
  },

  // ---------------------------------------------------------------- Operations
  ops_completed_month: {
    title: "Jobs completed by month",
    description: "How much work went out the door.",
    tab: "operations",
    access: "basic",
    monthly: { valueKey: "count" },
    empty: "No jobs were completed in this period.",
    async build(r, ctx) {
      const data = await q.jobsCompletedByMonth(ctx.tenantId, r);
      const by = new Map(data.map((d) => [d.month, d.count]));
      return {
        columns: [
          { key: "label", label: "Month", kind: "text" },
          { key: "count", label: "Jobs completed", kind: "int" },
        ],
        rows: monthsBetween(r.from, r.to).map((m) => ({ month: m, label: monthLabel(m, true), count: by.get(m) ?? 0 })),
      };
    },
  },
  ops_turnaround: {
    title: "Turnaround by product",
    description: "Average days from when the job was created to when it was completed, and how often it was done by the due date.",
    tab: "operations",
    access: "basic",
    bar: "avgDays",
    empty: "No jobs were completed in this period.",
    async build(r, ctx) {
      const data = await q.turnaroundByCategory(ctx.tenantId, r);
      return {
        columns: [
          { key: "label", label: "Product category", kind: "text" },
          { key: "count", label: "Completed", kind: "int", wide: true },
          { key: "avgDays", label: "Avg. days", kind: "days" },
          { key: "onTime", label: "On time", kind: "pct" },
        ],
        rows: data.map((d) => ({ label: d.label, count: d.count, avgDays: d.avgDays, onTime: d.withDue ? d.onTime / d.withDue : null })),
      };
    },
  },
  ops_overdue: {
    title: "Overdue jobs right now",
    description: "Past their due date and still being worked on.",
    tab: "operations",
    access: "basic",
    empty: "Nothing is overdue. Nice work.",
    async build(_r, ctx) {
      const { list } = await q.overdueJobs(ctx.tenantId, 50);
      return {
        columns: [
          { key: "job", label: "Job", kind: "text", href: "href" },
          { key: "title", label: "What", kind: "text" },
          { key: "customer", label: "Customer", kind: "text", wide: true },
          { key: "dueDate", label: "Was due", kind: "date", wide: true },
          { key: "daysLate", label: "Days late", kind: "int" },
          { key: "status", label: "Where it is", kind: "text", wide: true },
        ],
        rows: list.map((j) => ({
          job: jobNo(j.number),
          href: `/jobs/${j.number}`,
          title: j.title,
          customer: j.customer,
          dueDate: j.dueDate,
          daysLate: j.daysLate,
          status: STATUS_LABELS[j.status],
        })),
      };
    },
  },
  ops_proofs: {
    title: "Proofs waiting on the customer",
    description: "Sent, but the customer hasn't approved or asked for changes yet.",
    tab: "operations",
    access: "basic",
    empty: "No proofs are waiting on a customer.",
    async build(_r, ctx) {
      const list = await q.outstandingProofs(ctx.tenantId);
      return {
        columns: [
          { key: "job", label: "Job", kind: "text", href: "href" },
          { key: "title", label: "What", kind: "text" },
          { key: "customer", label: "Customer", kind: "text", wide: true },
          { key: "version", label: "Proof #", kind: "int", wide: true },
          { key: "sentAt", label: "Sent", kind: "date", wide: true },
          { key: "days", label: "Days waiting", kind: "int" },
        ],
        rows: list.map((p) => ({
          job: jobNo(p.jobNumber),
          href: `/jobs/${p.jobNumber}`,
          title: p.title,
          customer: p.customer,
          version: p.version,
          sentAt: p.sentAt,
          days: p.days,
        })),
      };
    },
  },

  // ---------------------------------------------------------------- Sales
  sales_people: {
    title: "Quotes by salesperson",
    description: "Quotes created in this period. Won = accepted or turned into a job. Lost = declined or expired.",
    tab: "sales",
    access: "basic",
    empty: "No quotes were created in this period.",
    async build(r, ctx) {
      const data = await q.quotesBySalesperson(ctx.tenantId, r);
      return {
        columns: [
          { key: "label", label: "Salesperson", kind: "text" },
          { key: "total", label: "Quotes", kind: "int" },
          { key: "won", label: "Won", kind: "int" },
          { key: "lost", label: "Lost", kind: "int" },
          { key: "winRate", label: "Win rate", kind: "pct" },
          { key: "wonCents", label: "Won value", kind: "money", money: true, wide: true },
        ],
        rows: data.map((d) => ({ ...d, winRate: d.won + d.lost ? d.won / (d.won + d.lost) : null })),
      };
    },
  },
  sales_lost: {
    title: "Why we lost quotes",
    description: "Reasons recorded when a quote was declined or expired.",
    tab: "sales",
    access: "basic",
    bar: "count",
    empty: "No quotes were lost in this period.",
    async build(r, ctx) {
      const data = await q.lostReasons(ctx.tenantId, r);
      return {
        columns: [
          { key: "label", label: "Reason", kind: "text" },
          { key: "count", label: "Quotes", kind: "int" },
          { key: "cents", label: "Value", kind: "money", money: true },
        ],
        rows: data,
      };
    },
  },

  // ---------------------------------------------------------------- Customers
  cust_top: {
    title: "Top customers",
    description: "Most jobs started in this period (and the most billed, for people who can see money).",
    tab: "customers",
    access: "basic",
    empty: "No customer activity in this period.",
    async build(r, ctx) {
      const data = await q.topCustomers(ctx.tenantId, r, ctx.financial);
      return {
        columns: [
          { key: "name", label: "Customer", kind: "text", href: "href" },
          { key: "jobs", label: "Jobs", kind: "int" },
          { key: "cents", label: "Billed", kind: "money", money: true },
        ],
        rows: data.map((c) => ({ name: c.name, jobs: c.jobs, cents: c.cents, href: `/customers/${c.id}` })),
      };
    },
  },
  cust_inactive: {
    title: "People to call",
    description: "Customers who ordered before but haven't started a job in over 6 months. Biggest customers first.",
    tab: "customers",
    access: "basic",
    empty: "Every past customer has ordered in the last 6 months.",
    async build(_r, ctx) {
      const data = await q.inactiveCustomers(ctx.tenantId, 50);
      return {
        columns: [
          { key: "name", label: "Customer", kind: "text", href: "href" },
          { key: "phone", label: "Phone", kind: "text" },
          { key: "email", label: "Email", kind: "text", wide: true },
          { key: "lastOrder", label: "Last order", kind: "date" },
          { key: "jobs", label: "Jobs ever", kind: "int", wide: true },
          { key: "lifetimeCents", label: "Billed ever", kind: "money", money: true, wide: true },
        ],
        rows: data.map((c) => ({ ...c, href: `/customers/${c.id}`, lifetimeCents: ctx.financial ? c.lifetimeCents : null })),
      };
    },
  },
} satisfies Record<string, ReportDef>;

export type ReportKey = keyof typeof REPORTS;

export function canSeeReport(def: ReportDef, ctx: ReportCtx) {
  return def.access === "basic" || (def.access === "financial" && ctx.financial) || (def.access === "margins" && ctx.margins);
}

/** Build a report and strip money columns for people who can't see money. */
export async function runReport(key: ReportKey, range: DateRange, ctx: ReportCtx): Promise<ReportTable> {
  const def: ReportDef = REPORTS[key];
  const t = await def.build(range, ctx);
  if (ctx.financial) return t;
  const hidden = t.columns.filter((c) => c.money || c.kind === "money").map((c) => c.key);
  return {
    ...t,
    columns: t.columns.filter((c) => !hidden.includes(c.key)),
    rows: t.rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !hidden.includes(k)))),
  };
}
