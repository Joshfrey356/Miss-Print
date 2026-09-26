import "server-only";
import { cache } from "react";
import { and, asc, desc, eq, ilike, inArray, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activityLogs,
  communications,
  customerContacts,
  customers,
  files,
  invoices,
  jobs,
  quotes,
  users,
} from "@/lib/db/schema";
import { getActiveUsers } from "@/lib/lookups";
import { addDays, today } from "@/lib/format";

export const PAGE_SIZE = 25;
export type CustomerFilter = "all" | "open" | "owes" | "exempt" | "inactive";
export const CUSTOMER_FILTERS: { key: CustomerFilter; label: string; money?: boolean }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Has open jobs" },
  { key: "owes", label: "Owes money", money: true },
  { key: "exempt", label: "Tax exempt" },
  { key: "inactive", label: "Inactive 12+ months" },
];
export type CustomerSort = "name" | "city" | "open" | "balance" | "last" | "revenue";

const CLOSED = ["completed", "cancelled"] as const;
const digitsOf = (s: string) => s.replace(/\D/g, "");
const escapeLike = (s: string) => s.replace(/[%_\\]/g, (m) => "\\" + m);
const phoneDigitsSql = (col: SQL | typeof customers.phone) => sql`regexp_replace(coalesce(${col}, ''), '[^0-9]', '', 'g')`;

/** Per-customer job aggregates (open jobs, last order date). */
function jobAgg() {
  return db
    .select({
      customerId: jobs.customerId,
      openJobs: sql<number>`(count(*) filter (where ${jobs.status} not in ('completed','cancelled')))::int`.as("open_jobs"),
      lastOrder: sql<string | null>`(max((${jobs.createdAt} at time zone 'America/Chicago')::date) filter (where ${jobs.status} <> 'cancelled'))::text`.as(
        "last_order",
      ),
    })
    .from(jobs)
    .where(isNull(jobs.archivedAt))
    .groupBy(jobs.customerId)
    .as("ja");
}

/** Per-customer invoice aggregates (balance, lifetime revenue, overdue). */
function invAgg(now: string) {
  return db
    .select({
      customerId: invoices.customerId,
      balance: sql<number>`coalesce(sum(${invoices.totalCents} - ${invoices.paidCents}) filter (where ${invoices.status} in ('sent','partial')), 0)::int`.as(
        "balance",
      ),
      revenue: sql<number>`coalesce(sum(${invoices.subtotalCents}) filter (where ${invoices.status} <> 'void'), 0)::int`.as("revenue"),
      overdue: sql<boolean>`coalesce(bool_or(${invoices.status} in ('sent','partial') and ${invoices.dueDate} < ${now}), false)`.as("overdue"),
    })
    .from(invoices)
    .groupBy(invoices.customerId)
    .as("ia");
}

export type CustomerListRow = {
  id: number;
  name: string;
  isCompany: boolean;
  city: string | null;
  phone: string | null;
  email: string | null;
  taxExempt: boolean;
  archived: boolean;
  primaryContact: string | null;
  openJobs: number;
  lastOrder: string | null;
  balance: number | null; // null when money is hidden
  revenue: number | null;
  overdue: boolean;
};

export async function listCustomers(opts: {
  q?: string;
  filter?: CustomerFilter;
  sort?: CustomerSort;
  dir?: "asc" | "desc";
  page?: number;
  showArchived?: boolean;
  showMoney: boolean;
}): Promise<{ rows: CustomerListRow[]; total: number; page: number }> {
  const now = today();
  const ja = jobAgg();
  const ia = invAgg(now);
  const q = opts.q?.trim().slice(0, 100) ?? "";
  const conds: (SQL | undefined)[] = [];

  if (!opts.showArchived) conds.push(isNull(customers.archivedAt));

  if (q) {
    const like = `%${escapeLike(q)}%`;
    const digits = digitsOf(q);
    const phoneLike = digits.length >= 3 ? `%${digits}%` : null;
    conds.push(
      or(
        ilike(customers.name, like),
        sql`similarity(${customers.name}, ${q}) > 0.3`,
        ilike(customers.email, like),
        ilike(customers.city, like),
        phoneLike ? sql`${phoneDigitsSql(customers.phone)} like ${phoneLike}` : undefined,
        sql`exists (select 1 from ${customerContacts} cc where cc.customer_id = ${customers.id} and cc.archived_at is null and (
          cc.name ilike ${like} or cc.email ilike ${like}
          ${phoneLike ? sql`or regexp_replace(coalesce(cc.phone, ''), '[^0-9]', '', 'g') like ${phoneLike}` : sql``}))`,
      ),
    );
  }

  const openJobs = sql<number>`coalesce(${ja.openJobs}, 0)`;
  const balance = sql<number>`coalesce(${ia.balance}, 0)`;
  const revenue = sql<number>`coalesce(${ia.revenue}, 0)`;

  switch (opts.filter) {
    case "open":
      conds.push(sql`${openJobs} > 0`);
      break;
    case "owes":
      if (opts.showMoney) conds.push(sql`${balance} > 0`);
      break;
    case "exempt":
      conds.push(eq(customers.taxExempt, true));
      break;
    case "inactive":
      conds.push(
        sql`coalesce(${ja.lastOrder}::date, ${customers.customerSince}, (${customers.createdAt} at time zone 'America/Chicago')::date) < ${addDays(now, -365)}::date`,
      );
      break;
  }

  const where = and(...conds);
  const dir = opts.dir === "desc" ? desc : asc;
  let sort = opts.sort;
  if ((sort === "balance" || sort === "revenue") && !opts.showMoney) sort = undefined;
  const order: SQL[] = [];
  switch (sort) {
    case "city":
      order.push(sql`${customers.city} ${sql.raw(opts.dir === "desc" ? "desc" : "asc")} nulls last`);
      break;
    case "open":
      order.push(dir(openJobs));
      break;
    case "balance":
      order.push(dir(balance));
      break;
    case "revenue":
      order.push(dir(revenue));
      break;
    case "last":
      order.push(sql`${ja.lastOrder} ${sql.raw(opts.dir === "asc" ? "asc" : "desc")} nulls last`);
      break;
    case "name":
      order.push(dir(sql`lower(${customers.name})`));
      break;
    default:
      if (q) order.push(sql`similarity(${customers.name}, ${q}) desc`);
  }
  order.push(asc(sql`lower(${customers.name})`), asc(customers.id));

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(customers)
    .leftJoin(ja, eq(ja.customerId, customers.id))
    .leftJoin(ia, eq(ia.customerId, customers.id))
    .where(where);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, opts.page ?? 1), pages);

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      isCompany: customers.isCompany,
      city: customers.city,
      phone: customers.phone,
      email: customers.email,
      taxExempt: customers.taxExempt,
      archivedAt: customers.archivedAt,
      primaryContact: sql<string | null>`(select cc.name from ${customerContacts} cc where cc.customer_id = ${customers.id} and cc.archived_at is null order by cc.is_primary desc, cc.id limit 1)`,
      openJobs,
      lastOrder: ja.lastOrder,
      balance,
      revenue,
      overdue: sql<boolean>`coalesce(${ia.overdue}, false)`,
    })
    .from(customers)
    .leftJoin(ja, eq(ja.customerId, customers.id))
    .leftJoin(ia, eq(ia.customerId, customers.id))
    .where(where)
    .orderBy(...order)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return {
    total,
    page,
    rows: rows.map(({ archivedAt, ...r }) => ({
      ...r,
      archived: archivedAt != null,
      openJobs: Number(r.openJobs),
      balance: opts.showMoney ? Number(r.balance) : null,
      revenue: opts.showMoney ? Number(r.revenue) : null,
      overdue: opts.showMoney ? Boolean(r.overdue) : false,
    })),
  };
}

// ---------------------------------------------------------------------------
// Single customer
// ---------------------------------------------------------------------------
export const getCustomer = cache(async (id: number) => {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [row] = await db
    .select({ customer: customers, salesperson: { id: users.id, name: users.name, color: users.color } })
    .from(customers)
    .leftJoin(users, eq(users.id, customers.salespersonId))
    .where(eq(customers.id, id))
    .limit(1);
  if (!row) return null;
  return { ...row.customer, salesperson: row.salesperson?.id ? row.salesperson : null };
});
export type CustomerDetail = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;

export async function getContacts(customerId: number) {
  return db
    .select()
    .from(customerContacts)
    .where(and(eq(customerContacts.customerId, customerId), isNull(customerContacts.archivedAt)))
    .orderBy(desc(customerContacts.isPrimary), asc(customerContacts.name));
}

export async function getPrimaryContact(customerId: number) {
  const [c] = await db
    .select()
    .from(customerContacts)
    .where(and(eq(customerContacts.customerId, customerId), isNull(customerContacts.archivedAt)))
    .orderBy(desc(customerContacts.isPrimary), asc(customerContacts.id))
    .limit(1);
  return c ?? null;
}

export async function getCustomerStats(customerId: number, showMoney: boolean) {
  const now = today();
  const [j] = await db
    .select({
      openJobs: sql<number>`(count(*) filter (where ${jobs.status} not in ('completed','cancelled')))::int`,
      totalJobs: sql<number>`(count(*) filter (where ${jobs.status} <> 'cancelled'))::int`,
      lastOrder: sql<string | null>`(max((${jobs.createdAt} at time zone 'America/Chicago')::date) filter (where ${jobs.status} <> 'cancelled'))::text`,
    })
    .from(jobs)
    .where(and(eq(jobs.customerId, customerId), isNull(jobs.archivedAt)));
  let money: { revenue: number; balance: number; overdue: number; openInvoices: number } | null = null;
  if (showMoney) {
    const [i] = await db
      .select({
        revenue: sql<number>`coalesce(sum(${invoices.subtotalCents}) filter (where ${invoices.status} <> 'void'), 0)::int`,
        balance: sql<number>`coalesce(sum(${invoices.totalCents} - ${invoices.paidCents}) filter (where ${invoices.status} in ('sent','partial')), 0)::int`,
        overdue: sql<number>`coalesce(sum(${invoices.totalCents} - ${invoices.paidCents}) filter (where ${invoices.status} in ('sent','partial') and ${invoices.dueDate} < ${now}), 0)::int`,
        openInvoices: sql<number>`(count(*) filter (where ${invoices.status} in ('sent','partial')))::int`,
      })
      .from(invoices)
      .where(eq(invoices.customerId, customerId));
    money = { revenue: Number(i.revenue), balance: Number(i.balance), overdue: Number(i.overdue), openInvoices: Number(i.openInvoices) };
  }
  return { openJobs: Number(j.openJobs), totalJobs: Number(j.totalJobs), lastOrder: j.lastOrder, money };
}

export type CustomerJobSort = "number" | "title" | "status" | "due" | "created" | "total";

export async function getCustomerJobs(
  customerId: number,
  opts: { showMoney: boolean; openOnly?: boolean; sort?: CustomerJobSort; dir?: "asc" | "desc" },
) {
  const d = opts.dir === "asc" ? asc : desc;
  const order: SQL[] = [];
  switch (opts.sort) {
    case "number":
      order.push(d(jobs.number));
      break;
    case "title":
      order.push(d(sql`lower(${jobs.title})`));
      break;
    case "status":
      order.push(d(jobs.status));
      break;
    case "due":
      order.push(sql`${jobs.dueDate} ${sql.raw(opts.dir === "asc" ? "asc" : "desc")} nulls last`);
      break;
    case "total":
      if (opts.showMoney) order.push(d(jobs.totalCents));
      break;
    case "created":
      order.push(d(jobs.createdAt));
      break;
  }
  if (opts.openOnly) order.push(sql`${jobs.dueDate} asc nulls last`);
  order.push(desc(jobs.createdAt));
  const rows = await db
    .select({
      id: jobs.id,
      number: jobs.number,
      title: jobs.title,
      status: jobs.status,
      priority: jobs.priority,
      dueDate: jobs.dueDate,
      createdAt: jobs.createdAt,
      completedAt: jobs.completedAt,
      totalCents: jobs.totalCents,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.customerId, customerId),
        isNull(jobs.archivedAt),
        opts.openOnly ? notInArray(jobs.status, [...CLOSED]) : undefined,
      ),
    )
    .orderBy(...order)
    .limit(500);
  return rows.map((r) => ({ ...r, totalCents: opts.showMoney ? r.totalCents : null }));
}

export async function getCustomerQuotes(customerId: number, opts: { showMoney: boolean; openOnly?: boolean }) {
  const rows = await db
    .select({
      id: quotes.id,
      number: quotes.number,
      title: quotes.title,
      status: quotes.status,
      totalCents: quotes.totalCents,
      validUntil: quotes.validUntil,
      sentAt: quotes.sentAt,
      createdAt: quotes.createdAt,
    })
    .from(quotes)
    .where(
      and(
        eq(quotes.customerId, customerId),
        isNull(quotes.archivedAt),
        opts.openOnly ? inArray(quotes.status, ["draft", "sent", "accepted"]) : undefined,
      ),
    )
    .orderBy(desc(quotes.createdAt))
    .limit(300);
  return rows.map((r) => ({ ...r, totalCents: opts.showMoney ? r.totalCents : null }));
}

export async function getCustomerInvoices(customerId: number) {
  return db
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      totalCents: invoices.totalCents,
      paidCents: invoices.paidCents,
      jobNumber: jobs.number,
    })
    .from(invoices)
    .leftJoin(jobs, eq(jobs.id, invoices.jobId))
    .where(eq(invoices.customerId, customerId))
    .orderBy(desc(invoices.issueDate), desc(invoices.id))
    .limit(300);
}

export async function getCustomerFiles(customerId: number) {
  return db
    .select({
      id: files.id,
      filename: files.filename,
      folder: files.folder,
      mimeType: files.mimeType,
      sizeBytes: files.sizeBytes,
      createdAt: files.createdAt,
      jobNumber: jobs.number,
      uploadedBy: users.name,
    })
    .from(files)
    .leftJoin(jobs, eq(jobs.id, files.jobId))
    .leftJoin(users, eq(users.id, files.uploadedBy))
    .where(and(eq(files.customerId, customerId), isNull(files.archivedAt)))
    .orderBy(desc(files.createdAt))
    .limit(500);
}

export async function getCustomerCommunications(customerId: number, opts: { showMoney: boolean; showPrices?: boolean }) {
  return db
    .select({
      id: communications.id,
      channel: communications.channel,
      direction: communications.direction,
      subject: communications.subject,
      body: communications.body,
      toAddress: communications.toAddress,
      status: communications.status,
      createdAt: communications.createdAt,
      jobNumber: jobs.number,
      sentBy: users.name,
    })
    .from(communications)
    .leftJoin(jobs, eq(jobs.id, communications.jobId))
    .leftJoin(users, eq(users.id, communications.sentBy))
    .where(
      and(
        eq(communications.customerId, customerId),
        // Invoice emails/reminders contain amounts — hide them from roles that can't see money.
        opts.showMoney ? undefined : isNull(communications.invoiceId),
        // Quote emails list every price — hide them from roles without financials.view.
        opts.showPrices ? undefined : isNull(communications.quoteId),
      ),
    )
    .orderBy(desc(communications.createdAt))
    .limit(200);
}

export async function getCustomerActivity(customerId: number, opts: { showMoney: boolean; showCost?: boolean; limit?: number }) {
  const rows = await db
    .select({
      id: activityLogs.id,
      action: activityLogs.action,
      summary: activityLogs.summary,
      createdAt: activityLogs.createdAt,
      actor: users.name,
      actorColor: users.color,
      jobNumber: jobs.number,
      jobTitle: jobs.title,
    })
    .from(activityLogs)
    .leftJoin(users, eq(users.id, activityLogs.actorId))
    .leftJoin(jobs, eq(jobs.id, activityLogs.jobId))
    .where(
      and(
        eq(activityLogs.customerId, customerId),
        opts.showMoney
          ? undefined
          : sql`not (${activityLogs.entityType} in ('invoice','payment','expense') or ${activityLogs.action} ilike '%price%' or ${activityLogs.action} ilike '%payment%' or ${activityLogs.action} ilike '%invoice%')`,
        // Expenses are costs (margins.view), even for people who can see prices.
        opts.showCost ? undefined : sql`${activityLogs.entityType} <> 'expense'`,
      ),
    )
    .orderBy(desc(activityLogs.createdAt))
    .limit(opts.limit ?? 15);
  // Some summaries carry an amount ("Created quote for $120.00").
  return opts.showMoney ? rows : rows.map((r) => ({ ...r, summary: r.summary.replace(/\s*(?:for\s+)?\(?-?\$[\d,]+(?:\.\d+)?\)?/g, "") }));
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------
/** People who can be assigned as a customer's salesperson. */
export async function getSalespeople() {
  return (await getActiveUsers()).filter((u) => u.role === "owner" || u.role === "manager" || u.role === "sales");
}

export type DuplicateMatch = { id: number; name: string; reason: string; city: string | null; archived: boolean };

/** Possible duplicates: similar name, same phone, or same email (customer or contact). */
export async function findDuplicateCustomers(input: {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  excludeId?: number | null;
}): Promise<DuplicateMatch[]> {
  const name = input.name?.trim() ?? "";
  const phone = digitsOf(input.phone ?? "").slice(-10);
  const email = input.email?.trim().toLowerCase() ?? "";
  const conds: SQL[] = [];
  if (name.length >= 3) conds.push(sql`(lower(${customers.name}) = lower(${name}) or similarity(${customers.name}, ${name}) > 0.5)`);
  if (phone.length >= 7) {
    conds.push(sql`right(${phoneDigitsSql(customers.phone)}, 10) = ${phone}`);
    conds.push(
      sql`exists (select 1 from ${customerContacts} cc where cc.customer_id = ${customers.id} and cc.archived_at is null and right(regexp_replace(coalesce(cc.phone, ''), '[^0-9]', '', 'g'), 10) = ${phone})`,
    );
  }
  if (email.includes("@")) {
    conds.push(sql`lower(${customers.email}) = ${email}`);
    conds.push(sql`exists (select 1 from ${customerContacts} cc where cc.customer_id = ${customers.id} and cc.archived_at is null and lower(cc.email) = ${email})`);
  }
  if (!conds.length) return [];
  const sim = name.length >= 3 ? sql<number>`similarity(${customers.name}, ${name})` : sql<number>`0`;
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      city: customers.city,
      phone: customers.phone,
      email: customers.email,
      archivedAt: customers.archivedAt,
      sim,
    })
    .from(customers)
    .where(and(or(...conds), input.excludeId ? ne(customers.id, input.excludeId) : undefined))
    .orderBy(desc(sim), asc(customers.id))
    .limit(5);
  return rows.map((r) => {
    const reasons: string[] = [];
    if (phone.length >= 7 && digitsOf(r.phone ?? "").slice(-10) === phone) reasons.push("same phone");
    if (email && r.email?.toLowerCase() === email) reasons.push("same email");
    if (name.length >= 3 && (Number(r.sim) > 0.5 || r.name.toLowerCase() === name.toLowerCase())) reasons.push("similar name");
    if (!reasons.length) reasons.push("same contact phone or email");
    return { id: r.id, name: r.name, city: r.city, archived: r.archivedAt != null, reason: reasons.join(", ") };
  });
}

/** Counts for the customer page tabs. */
export async function getCustomerCounts(customerId: number, opts: { showMoney: boolean }) {
  const [r] = await db.execute<{ jobs: number; quotes: number; invoices: number; files: number; comms: number }>(sql`
    select
      (select count(*)::int from ${jobs} where customer_id = ${customerId} and archived_at is null) as jobs,
      (select count(*)::int from ${quotes} where customer_id = ${customerId} and archived_at is null) as quotes,
      (select count(*)::int from ${invoices} where customer_id = ${customerId}) as invoices,
      (select count(*)::int from ${files} where customer_id = ${customerId} and archived_at is null) as files,
      (select count(*)::int from ${communications} where customer_id = ${customerId} ${opts.showMoney ? sql`` : sql`and invoice_id is null`}) as comms
  `);
  return {
    jobs: Number(r?.jobs ?? 0),
    quotes: Number(r?.quotes ?? 0),
    invoices: opts.showMoney ? Number(r?.invoices ?? 0) : 0,
    files: Number(r?.files ?? 0),
    comms: Number(r?.comms ?? 0),
  };
}
