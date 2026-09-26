import "server-only";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerContacts, customers, invoices, jobs, quotes } from "@/lib/db/schema";
import { can } from "@/lib/permissions";
import type { SessionUser } from "@/lib/auth";
import { fmtDate, invoiceNo, jobNo, money, quoteNo } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/jobs/workflow";

export type SearchResult = {
  type: "job" | "customer" | "contact" | "quote" | "invoice";
  id: number;
  title: string;
  subtitle?: string;
  href: string;
  meta?: string;
};

const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Global search (⌘K). Database search with trigram/ILIKE today.
 * Designed so an embedding-based semantic search can be merged in later (see lib/ai).
 */
export async function globalSearch(user: SessionUser, raw: string): Promise<SearchResult[]> {
  const q = raw.trim().slice(0, 100);
  if (q.length < 2) return [];
  const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
  const num = q.match(/^(?:mp|q|inv)?[-\s#]?(\d{3,7})$/i)?.[1];
  const phone = digits(q).length >= 4 ? digits(q) : null;
  const out: SearchResult[] = [];
  const tenantId = user.tenantId; // every query below is limited to the signed-in user's shop

  const tasks: Promise<void>[] = [];

  if (can(user.role, "jobs.view")) {
    tasks.push(
      (async () => {
        const rows = await db
          .select({ id: jobs.id, number: jobs.number, title: jobs.title, status: jobs.status, due: jobs.dueDate, customer: customers.name })
          .from(jobs)
          .innerJoin(customers, eq(customers.id, jobs.customerId))
          .where(
            and(
              eq(jobs.tenantId, tenantId),
              isNull(jobs.archivedAt),
              or(
                num ? eq(jobs.number, Number(num)) : undefined,
                ilike(jobs.title, like),
                ilike(customers.name, like),
                ilike(jobs.description, like),
                ilike(jobs.poNumber, like),
              ),
            ),
          )
          .orderBy(num ? sql`(${jobs.number} = ${Number(num) || 0}) desc` : sql`1`, desc(jobs.createdAt))
          .limit(8);
        for (const r of rows)
          out.push({
            type: "job",
            id: r.id,
            title: `${jobNo(r.number)} · ${r.title}`,
            subtitle: `${r.customer} · ${STATUS_LABELS[r.status]}`,
            href: `/jobs/${r.number}`,
            meta: r.due ? `Due ${fmtDate(r.due, { weekday: false })}` : undefined,
          });
      })(),
    );
  }

  if (can(user.role, "customers.view")) {
    tasks.push(
      (async () => {
        const rows = await db
          .select({ id: customers.id, name: customers.name, phone: customers.phone, email: customers.email, city: customers.city })
          .from(customers)
          .where(
            and(
              eq(customers.tenantId, tenantId),
              isNull(customers.archivedAt),
              or(
                ilike(customers.name, like),
                ilike(customers.email, like),
                phone ? sql`regexp_replace(coalesce(${customers.phone}, ''), '\\D', '', 'g') like ${"%" + phone + "%"}` : undefined,
              ),
            ),
          )
          .orderBy(sql`similarity(${customers.name}, ${q}) desc`)
          .limit(6);
        for (const r of rows)
          out.push({ type: "customer", id: r.id, title: r.name, subtitle: [r.phone, r.email, r.city].filter(Boolean).join(" · "), href: `/customers/${r.id}` });

        const contacts = await db
          .select({ id: customerContacts.id, name: customerContacts.name, phone: customerContacts.phone, email: customerContacts.email, customerId: customers.id, customer: customers.name })
          .from(customerContacts)
          .innerJoin(customers, eq(customers.id, customerContacts.customerId))
          .where(
            and(
              eq(customerContacts.tenantId, tenantId),
              isNull(customerContacts.archivedAt),
              or(
                ilike(customerContacts.name, like),
                ilike(customerContacts.email, like),
                phone ? sql`regexp_replace(coalesce(${customerContacts.phone}, ''), '\\D', '', 'g') like ${"%" + phone + "%"}` : undefined,
              ),
            ),
          )
          .limit(5);
        for (const r of contacts)
          out.push({ type: "contact", id: r.id, title: r.name, subtitle: `${r.customer}${r.phone ? " · " + r.phone : ""}`, href: `/customers/${r.customerId}` });
      })(),
    );
  }

  if (can(user.role, "quotes.view")) {
    tasks.push(
      (async () => {
        const rows = await db
          .select({ id: quotes.id, number: quotes.number, title: quotes.title, total: quotes.totalCents, customer: customers.name, status: quotes.status })
          .from(quotes)
          .innerJoin(customers, eq(customers.id, quotes.customerId))
          .where(
            and(
              eq(quotes.tenantId, tenantId),
              isNull(quotes.archivedAt),
              or(num ? eq(quotes.number, Number(num)) : undefined, ilike(quotes.title, like), ilike(customers.name, like)),
            ),
          )
          .orderBy(desc(quotes.createdAt))
          .limit(5);
        const showMoney = can(user.role, "financials.view");
        for (const r of rows)
          out.push({ type: "quote", id: r.id, title: `${quoteNo(r.number)} · ${r.title}`, subtitle: r.customer, href: `/quotes/${r.id}`, meta: showMoney ? money(r.total) : undefined });
      })(),
    );
  }

  if (can(user.role, "money.view")) {
    tasks.push(
      (async () => {
        const rows = await db
          .select({ id: invoices.id, number: invoices.number, total: invoices.totalCents, customer: customers.name, status: invoices.status })
          .from(invoices)
          .innerJoin(customers, eq(customers.id, invoices.customerId))
          .where(and(eq(invoices.tenantId, tenantId), or(num ? eq(invoices.number, Number(num)) : undefined, ilike(customers.name, like))))
          .orderBy(desc(invoices.issueDate))
          .limit(5);
        for (const r of rows)
          out.push({ type: "invoice", id: r.id, title: invoiceNo(r.number), subtitle: r.customer, href: `/money/invoices/${r.id}`, meta: money(r.total) });
      })(),
    );
  }

  await Promise.all(tasks);
  return out;
}
