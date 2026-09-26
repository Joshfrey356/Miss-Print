import { NextResponse } from "next/server";
import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { customerContacts, customers } from "@/lib/db/schema";

/** Customer picker lookup: ?q= (name/phone/email/contact) or ?id= */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "customers.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const id = Number(sp.get("id")) || null;
  const q = (sp.get("q") ?? "").trim().slice(0, 80);
  const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
  const digits = q.replace(/\D/g, "");
  const rows = await db
    .select({ id: customers.id, name: customers.name, phone: customers.phone, email: customers.email, city: customers.city, taxExempt: customers.taxExempt, discountPct: customers.discountPct, poRequired: customers.poRequired, salespersonId: customers.salespersonId })
    .from(customers)
    .where(
      and(
        eq(customers.tenantId, user.tenantId),
        isNull(customers.archivedAt),
        id
          ? eq(customers.id, id)
          : q
            ? or(
                ilike(customers.name, like),
                ilike(customers.email, like),
                digits.length >= 4 ? sql`regexp_replace(coalesce(${customers.phone}, ''), '\\D', '', 'g') like ${"%" + digits + "%"}` : undefined,
                sql`exists (select 1 from ${customerContacts} cc where cc.customer_id = ${customers.id} and cc.name ilike ${like})`,
              )
            : undefined,
      ),
    )
    .orderBy(q ? sql`similarity(${customers.name}, ${q}) desc` : asc(customers.name))
    .limit(10);
  const contacts = rows.length
    ? await db
        .select({ id: customerContacts.id, customerId: customerContacts.customerId, name: customerContacts.name, email: customerContacts.email, isPrimary: customerContacts.isPrimary })
        .from(customerContacts)
        .where(and(eq(customerContacts.tenantId, user.tenantId), inArray(customerContacts.customerId, rows.map((r) => r.id)), isNull(customerContacts.archivedAt)))
    : [];
  // The customer discount is pricing data: only for roles that can see prices.
  const showMoney = can(user.role, "financials.view");
  return NextResponse.json({ customers: rows.map((r) => ({ ...r, discountPct: showMoney ? r.discountPct : 0, contacts: contacts.filter((c) => c.customerId === r.id) })) });
}
