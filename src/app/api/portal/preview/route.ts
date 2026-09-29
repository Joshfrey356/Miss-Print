import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { customerContacts, customers, portalSessions } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { can } from "@/lib/permissions";
import { forbidden, sameOrigin } from "@/lib/http";
import { tokensAfterSignIn } from "@/lib/portal/links";
import { cookieTokens, portalCookies } from "@/lib/portal/session";
import { hashPortalToken, newPortalToken } from "@/lib/portal/tokens";

/** A staff preview lasts two hours; it's for looking, not for customers. */
const PREVIEW_MS = 2 * 60 * 60 * 1000;

/**
 * Staff "Preview portal" button: open the customer portal as this customer sees it, without needing
 * the customer's email or email sending. The session is read-only (every customer action is refused)
 * and doesn't count as a customer visit.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getCurrentUser();
  if (!user) return redirect("/login?next=/customers");
  // The portal shows the customer's invoices and balances.
  if (!can(user.role, "customers.edit") || !can(user.role, "financials.view")) return forbidden("You don't have permission to preview the customer portal.");
  const customerId = Number((await req.formData()).get("customerId"));
  if (!Number.isInteger(customerId) || customerId <= 0) return new Response("Customer not found.", { status: 404 });
  const [customer] = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, customerId), isNull(customers.archivedAt)));
  if (!customer) return new Response("Customer not found.", { status: 404 });
  const [primary] = await db
    .select({ id: customerContacts.id })
    .from(customerContacts)
    .where(and(eq(customerContacts.tenantId, user.tenantId), eq(customerContacts.customerId, customerId), eq(customerContacts.isPrimary, true), isNull(customerContacts.archivedAt)))
    .limit(1);

  const token = newPortalToken();
  const h = await headers();
  await db.insert(portalSessions).values({
    id: hashPortalToken(token),
    tenantId: user.tenantId,
    customerId,
    contactId: primary?.id ?? null,
    email: user.email.toLowerCase(),
    expiresAt: new Date(Date.now() + PREVIEW_MS),
    lastSeenAt: new Date(),
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    previewBy: user.id,
  });
  await logActivity({ tenantId: user.tenantId, action: "portal.previewed", entityType: "customer", entityId: customerId, customerId, actorId: user.id, summary: `Previewed the customer portal as ${customer.name}` });
  const tokens = await tokensAfterSignIn(await cookieTokens(), token, user.tenantId, customerId);
  return redirect("/portal/home", portalCookies(tokens));
}

function redirect(location: string, cookies: string[] = []) {
  const res = new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}
