import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityLogs, customerContacts, customers, jobs, productCategories, quoteItems, quotes, users, type QuoteStatus } from "@/lib/db/schema";

export const QUOTE_VIEWS = [
  { key: "open", label: "Open", statuses: ["draft", "sent"] as QuoteStatus[] },
  { key: "followup", label: "Needs follow-up", statuses: ["sent"] as QuoteStatus[] },
  { key: "accepted", label: "Accepted — convert", statuses: ["accepted"] as QuoteStatus[] },
  { key: "won", label: "Won", statuses: ["converted", "accepted"] as QuoteStatus[] },
  { key: "lost", label: "Lost", statuses: ["declined", "expired"] as QuoteStatus[] },
  { key: "all", label: "All", statuses: [] as QuoteStatus[] },
];

/** Quotes sent more than this many days ago with no answer need a follow-up. */
export const FOLLOWUP_DAYS = 7;

export async function listQuotes(f: { view?: string; q?: string; sort?: string; dir?: string; page?: number }) {
  const pageSize = 30;
  const page = Math.max(1, f.page ?? 1);
  const view = QUOTE_VIEWS.find((v) => v.key === (f.view ?? "open")) ?? QUOTE_VIEWS[0]!;
  const w: SQL[] = [isNull(quotes.archivedAt)];
  if (view.statuses.length) w.push(inArray(quotes.status, view.statuses));
  if (view.key === "followup") w.push(sql`${quotes.sentAt} < now() - make_interval(days => ${FOLLOWUP_DAYS})`);
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    const num = f.q.trim().match(/^(?:q)?[-\s#]?(\d{3,6})$/i)?.[1];
    w.push(or(num ? eq(quotes.number, Number(num)) : undefined, ilike(quotes.title, like), ilike(customers.name, like))!);
  }
  const dir = f.dir === "asc" ? asc : desc;
  const order =
    f.sort === "total" ? dir(quotes.totalCents) : f.sort === "customer" ? dir(customers.name) : f.sort === "number" ? dir(quotes.number) : view.key === "followup" ? asc(quotes.sentAt) : desc(quotes.updatedAt);
  const where = and(...w);
  const [rows, [{ n, value }]] = await Promise.all([
    db
      .select({
        id: quotes.id,
        number: quotes.number,
        title: quotes.title,
        status: quotes.status,
        totalCents: quotes.totalCents,
        subtotalCents: quotes.subtotalCents,
        sentAt: quotes.sentAt,
        createdAt: quotes.createdAt,
        updatedAt: quotes.updatedAt,
        validUntil: quotes.validUntil,
        customer: customers.name,
        customerId: customers.id,
        salesperson: users.name,
        salesColor: users.color,
      })
      .from(quotes)
      .innerJoin(customers, eq(customers.id, quotes.customerId))
      .leftJoin(users, eq(users.id, quotes.salespersonId))
      .where(where)
      .orderBy(order)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ n: sql<number>`count(*)::int`, value: sql<number>`coalesce(sum(${quotes.subtotalCents}), 0)::bigint` })
      .from(quotes)
      .innerJoin(customers, eq(customers.id, quotes.customerId))
      .where(where),
  ]);
  return { rows, total: n, value: Number(value), page, pageSize };
}

export async function quoteCounts() {
  const [r] = await db
    .select({
      open: sql<number>`count(*) filter (where ${quotes.status} in ('draft','sent'))::int`,
      followup: sql<number>`count(*) filter (where ${quotes.status} = 'sent' and ${quotes.sentAt} < now() - make_interval(days => ${FOLLOWUP_DAYS}))::int`,
      accepted: sql<number>`count(*) filter (where ${quotes.status} = 'accepted')::int`,
    })
    .from(quotes)
    .where(isNull(quotes.archivedAt));
  return r!;
}

export async function getQuoteDetail(id: number) {
  const [row] = await db
    .select({
      quote: quotes,
      customer: { id: customers.id, name: customers.name, email: customers.email, phone: customers.phone, taxExempt: customers.taxExempt },
      contact: { name: customerContacts.name, email: customerContacts.email, phone: customerContacts.phone },
      salesperson: users.name,
    })
    .from(quotes)
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .leftJoin(customerContacts, eq(customerContacts.id, quotes.contactId))
    .leftJoin(users, eq(users.id, quotes.salespersonId))
    .where(eq(quotes.id, id));
  if (!row) return null;
  const [items, activity, job] = await Promise.all([
    db
      .select({ item: quoteItems, category: productCategories.name })
      .from(quoteItems)
      .leftJoin(productCategories, eq(productCategories.id, quoteItems.categoryId))
      .where(eq(quoteItems.quoteId, id))
      .orderBy(asc(quoteItems.sortOrder)),
    db
      .select({ id: activityLogs.id, action: activityLogs.action, summary: activityLogs.summary, at: activityLogs.createdAt, by: users.name, byColor: users.color })
      .from(activityLogs)
      .leftJoin(users, eq(users.id, activityLogs.actorId))
      .where(eq(activityLogs.quoteId, id))
      .orderBy(desc(activityLogs.createdAt)),
    db.select({ number: jobs.number }).from(jobs).where(eq(jobs.quoteId, id)).limit(1),
  ]);
  return { ...row, items, activity, jobNumber: job[0]?.number ?? null };
}
