import "server-only";
import { and, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, expenses, invoices, jobs, messages, payments, productCategories, proofs, quotes, users } from "@/lib/db/schema";
import { addDays, shopMidnight, today } from "@/lib/format";
import { ACTIVE_STATUSES, WORK_STATUSES } from "@/lib/jobs/workflow";
import { getSettings } from "@/lib/settings";
import { FOLLOWUP_DAYS } from "@/lib/quotes/queries";

const monthStart = (ymd: string) => ymd.slice(0, 8) + "01";
/** Monday of the current week (shop time). */
function weekStart(ymd: string) {
  const d = new Date(ymd + "T12:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(ymd, -dow);
}

/** TODAY counts — everyone sees these (no money). */
export async function todayCounts() {
  const t = today();
  const dayStart = shopMidnight(t).toISOString();
  const dayEnd = shopMidnight(addDays(t, 1)).toISOString();
  const [[j], [q], [p], [inv], [missingArt]] = await Promise.all([
    db
      .select({
        dueToday: sql<number>`count(*) filter (where ${inArray(jobs.status, ACTIVE_STATUSES)} and ${jobs.dueDate} = ${t})::int`,
        overdue: sql<number>`count(*) filter (where ${inArray(jobs.status, WORK_STATUSES)} and ${jobs.dueDate} < ${t})::int`,
        ready: sql<number>`count(*) filter (where ${jobs.status} = 'ready_pickup')::int`,
        installsToday: sql<number>`count(*) filter (where ${jobs.status} = 'scheduled_install' and ${jobs.fulfillmentAt} >= ${dayStart} and ${jobs.fulfillmentAt} < ${dayEnd})::int`,
        rush: sql<number>`count(*) filter (where ${inArray(jobs.status, WORK_STATUSES)} and ${jobs.priority} <> 'normal')::int`,
        inProduction: sql<number>`count(*) filter (where ${inArray(jobs.status, ["approved_for_production", "production", "finishing", "quality_check"])})::int`,
      })
      .from(jobs)
      .where(isNull(jobs.archivedAt)),
    db
      .select({
        awaiting: sql<number>`count(*) filter (where ${quotes.status} = 'sent')::int`,
        stale: sql<number>`count(*) filter (where ${quotes.status} = 'sent' and ${quotes.sentAt} < now() - make_interval(days => ${FOLLOWUP_DAYS}))::int`,
        accepted: sql<number>`count(*) filter (where ${quotes.status} = 'accepted')::int`,
      })
      .from(quotes)
      .where(isNull(quotes.archivedAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(proofs).where(eq(proofs.status, "sent")),
    db
      .select({
        unpaid: sql<number>`count(*) filter (where ${inArray(invoices.status, ["sent", "partial"])})::int`,
        overdue: sql<number>`count(*) filter (where ${inArray(invoices.status, ["sent", "partial"])} and ${invoices.dueDate} < ${t})::int`,
      })
      .from(invoices),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(jobs)
      .where(
        and(
          isNull(jobs.archivedAt),
          inArray(jobs.status, ["approved_for_production", "production"]),
          sql`not exists (select 1 from files f where f.job_id = ${jobs.id} and f.folder in ('original_artwork','customer','production') and f.archived_at is null)`,
        ),
      ),
  ]);
  return { ...j!, quotesAwaiting: q!.awaiting, quotesStale: q!.stale, quotesAccepted: q!.accepted, proofsAwaiting: p!.n, unpaidInvoices: inv!.unpaid, overdueInvoices: inv!.overdue, missingArtwork: missingArt!.n };
}

/** Money cards (owner / accounting / managers with financials). Revenue = invoice subtotals (no tax). */
export async function moneyCards() {
  const t = today();
  const ms = monthStart(t);
  const ws = weekStart(t);
  const { rules } = await getSettings();
  const [[s], [ar], [oq], [cash], [exp], [cogs]] = await Promise.all([
    db
      .select({
        today: sql<number>`coalesce(sum(${invoices.subtotalCents}) filter (where ${invoices.issueDate} = ${t}), 0)::bigint`,
        week: sql<number>`coalesce(sum(${invoices.subtotalCents}) filter (where ${invoices.issueDate} >= ${ws}), 0)::bigint`,
        month: sql<number>`coalesce(sum(${invoices.subtotalCents}) filter (where ${invoices.issueDate} >= ${ms}), 0)::bigint`,
      })
      .from(invoices)
      .where(and(ne(invoices.status, "void"), gte(invoices.issueDate, addDays(ms, -7)))),
    db
      .select({ outstanding: sql<number>`coalesce(sum(${invoices.totalCents} - ${invoices.paidCents}), 0)::bigint`, n: sql<number>`count(*)::int` })
      .from(invoices)
      .where(inArray(invoices.status, ["sent", "partial"])),
    db
      .select({ n: sql<number>`count(*)::int`, value: sql<number>`coalesce(sum(${quotes.subtotalCents}), 0)::bigint` })
      .from(quotes)
      .where(and(inArray(quotes.status, ["draft", "sent", "accepted"]), isNull(quotes.archivedAt))),
    db.select({ v: sql<number>`coalesce(sum(${payments.amountCents}), 0)::bigint` }).from(payments).where(and(gte(payments.receivedOn, ms), isNull(payments.voidedAt))),
    db.select({ v: sql<number>`coalesce(sum(${expenses.amountCents}), 0)::bigint` }).from(expenses).where(and(gte(expenses.spentOn, ms), isNull(expenses.archivedAt))),
    // Estimated COGS for this month's invoiced jobs: attached job expenses + labor hours × labor cost.
    db
      .select({
        v: sql<number>`coalesce(sum((select coalesce(sum(e.amount_cents), 0) from expenses e where e.job_id = ${invoices.jobId} and e.archived_at is null) + coalesce(${jobs.laborHours}, 0) * ${rules.laborCostPerHourCents}), 0)::bigint`,
      })
      .from(invoices)
      .leftJoin(jobs, eq(jobs.id, invoices.jobId))
      .where(and(ne(invoices.status, "void"), gte(invoices.issueDate, ms))),
  ]);
  const month = Number(s!.month);
  return {
    salesToday: Number(s!.today),
    salesWeek: Number(s!.week),
    salesMonth: month,
    outstanding: Number(ar!.outstanding),
    outstandingCount: ar!.n,
    openQuotes: oq!.n,
    openQuotesValue: Number(oq!.value),
    cashMonth: Number(cash!.v),
    expensesMonth: Number(exp!.v),
    grossProfitMonth: month - Number(cogs!.v),
  };
}

export async function revenueByMonth(months = 12) {
  const t = today();
  const from = addDays(monthStart(t), 0).slice(0, 7);
  const start = new Date(`${from}-01T12:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - (months - 1));
  const fromYmd = start.toISOString().slice(0, 10);
  const rows = await db
    .select({ m: sql<string>`to_char(${invoices.issueDate}, 'YYYY-MM')`, v: sql<number>`sum(${invoices.subtotalCents})::bigint`, n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(and(ne(invoices.status, "void"), gte(invoices.issueDate, fromYmd)))
    .groupBy(sql`1`);
  const map = new Map(rows.map((r) => [r.m, r]));
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(start);
    d.setUTCMonth(start.getUTCMonth() + i);
    const key = d.toISOString().slice(0, 7);
    const r = map.get(key);
    return { key, label: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), value: Number(r?.v ?? 0), count: r?.n ?? 0 };
  });
}

export async function salesByCategory(days = 90) {
  const from = addDays(today(), -days);
  const rows = await db
    .select({ name: sql<string>`coalesce(${productCategories.name}, 'Other')`, v: sql<number>`sum(${invoices.subtotalCents})::bigint` })
    .from(invoices)
    .leftJoin(jobs, eq(jobs.id, invoices.jobId))
    .leftJoin(productCategories, eq(productCategories.id, jobs.categoryId))
    .where(and(ne(invoices.status, "void"), gte(invoices.issueDate, from)))
    .groupBy(sql`1`)
    .orderBy(sql`2 desc`);
  const top = rows.slice(0, 6).map((r) => ({ label: r.name, value: Number(r.v) }));
  const rest = rows.slice(6).reduce((a, r) => a + Number(r.v), 0);
  if (rest > 0) top.push({ label: "Everything else", value: rest });
  return top;
}

export async function quoteWinRate(days = 90) {
  const [r] = await db
    .select({
      won: sql<number>`count(*) filter (where ${quotes.status} in ('accepted','converted'))::int`,
      lost: sql<number>`count(*) filter (where ${quotes.status} in ('declined','expired'))::int`,
    })
    .from(quotes)
    .where(and(isNull(quotes.archivedAt), gte(quotes.createdAt, new Date(Date.now() - days * 86400000))));
  const decided = r!.won + r!.lost;
  return { won: r!.won, lost: r!.lost, rate: decided ? r!.won / decided : null };
}

export async function jobsCompletedByMonth(months = 6) {
  const start = new Date(`${today().slice(0, 7)}-01T12:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - (months - 1));
  const rows = await db
    .select({ m: sql<string>`to_char(${jobs.completedAt} at time zone 'America/Chicago', 'YYYY-MM')`, n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.status, "completed"), gte(jobs.completedAt, start)))
    .groupBy(sql`1`);
  const map = new Map(rows.map((r) => [r.m, r.n]));
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(start);
    d.setUTCMonth(start.getUTCMonth() + i);
    const key = d.toISOString().slice(0, 7);
    return { label: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), value: map.get(key) ?? 0 };
  });
}

/** Important internal messages + my unread mentions from the last 3 days. */
export async function importantMessages(userId: number) {
  const since = new Date(Date.now() - 3 * 86400000);
  return db
    .select({ id: messages.id, body: messages.body, at: messages.createdAt, channel: messages.channel, jobNumber: jobs.number, jobTitle: jobs.title, author: users.name, color: users.color })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .leftJoin(jobs, eq(jobs.id, messages.jobId))
    .where(
      and(
        isNull(messages.archivedAt),
        gte(messages.createdAt, since),
        or(eq(messages.important, true), sql`exists (select 1 from mentions m where m.message_id = ${messages.id} and m.user_id = ${userId})`),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(6);
}

/** Lists for "Needs attention" drilldowns. */
export async function attentionJobs() {
  const t = today();
  return db
    .select({ number: jobs.number, title: jobs.title, customer: customers.name, dueDate: jobs.dueDate, status: jobs.status, priority: jobs.priority })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(and(isNull(jobs.archivedAt), inArray(jobs.status, WORK_STATUSES), lte(jobs.dueDate, t)))
    .orderBy(jobs.dueDate)
    .limit(8);
}

/** Jobs a specific person should work on next (their stage), for non-owner dashboards. */
export async function myQueue(userId: number, role: string) {
  const t = today();
  const stage =
    role === "designer" ? and(eq(jobs.designerId, userId), inArray(jobs.status, ["waiting_artwork", "design", "proof_ready", "waiting_approval"])) :
    role === "production" ? and(or(eq(jobs.productionId, userId), isNull(jobs.productionId)), inArray(jobs.status, ["approved_for_production", "production", "finishing", "quality_check"])) :
    role === "installer" ? and(eq(jobs.installerId, userId), inArray(jobs.status, ["scheduled_install", "quality_check", "finishing"])) :
    and(eq(jobs.salespersonId, userId), inArray(jobs.status, [...ACTIVE_STATUSES]));
  const rows = await db
    .select({ id: jobs.id, number: jobs.number, title: jobs.title, customer: customers.name, dueDate: jobs.dueDate, status: jobs.status, priority: jobs.priority, fulfillmentAt: jobs.fulfillmentAt, siteAddress: jobs.siteAddress })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(and(isNull(jobs.archivedAt), stage))
    .orderBy(sql`case ${jobs.priority} when 'critical' then 0 when 'rush' then 1 else 2 end`, sql`${jobs.dueDate} asc nulls last`)
    .limit(12);
  return rows.map((r) => ({ ...r, overdue: !!r.dueDate && r.dueDate < t && WORK_STATUSES.includes(r.status) }));
}

