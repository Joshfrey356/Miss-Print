import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerContacts, customers } from "@/lib/db/schema";
import { getTenant } from "@/lib/tenant";
import { listPortalAccess } from "@/lib/portal/links";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { getPortalSettings } from "@/lib/portal/settings";
import { PortalAccessList, PortalInviteButton } from "./customer-portal-card-client";
import { Eye } from "lucide-react";

/**
 * Staff: "Customer portal" card for the customer page. Who can sign in, when they last visited,
 * invite someone (emails a branded sign-in link) and turn access off. Self-contained: pass the shop,
 * the customer and whether the viewer has customers.edit.
 */
export async function CustomerPortalCard({
  tenantId,
  customerId,
  canEdit,
  canPreview = false,
}: {
  tenantId: number;
  customerId: number;
  canEdit: boolean;
  /** Staff who can edit customers and see prices can open the portal as this customer sees it. */
  canPreview?: boolean;
}) {
  const [cust] = await db.select({ id: customers.id, email: customers.email, name: customers.name, archivedAt: customers.archivedAt }).from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
  if (!cust) return null;
  const [contacts, access, tenant, portal] = await Promise.all([
    db
      .select({ id: customerContacts.id, name: customerContacts.name, email: customerContacts.email })
      .from(customerContacts)
      .where(and(eq(customerContacts.tenantId, tenantId), eq(customerContacts.customerId, customerId), isNull(customerContacts.archivedAt)))
      .orderBy(asc(customerContacts.name)),
    listPortalAccess(tenantId, customerId),
    getTenant(tenantId),
    getPortalSettings(tenantId),
  ]);
  const people = [
    ...contacts.filter((c) => c.email).map((c) => ({ contactId: c.id as number | null, name: c.name, email: c.email!.toLowerCase() })),
    ...(cust.email && !contacts.some((c) => c.email?.toLowerCase() === cust.email!.toLowerCase()) ? [{ contactId: null, name: cust.name, email: cust.email.toLowerCase() }] : []),
  ];
  const portalUrl = `/portal${tenant ? `?shop=${tenant.slug}` : ""}`;
  return (
    <Card>
      <CardHeader
        title="Customer portal"
        description="Customers check orders, approve proofs, accept quotes, pay and reorder online."
        action={
          (canPreview || (canEdit && portal.enabled)) && !cust.archivedAt ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {canPreview && (
                // A plain form post in a new tab: the preview gets its own portal session, the app stays open here.
                <form action="/api/portal/preview" method="post" target="_blank">
                  <input type="hidden" name="customerId" value={customerId} />
                  <button
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                    title="Open the portal as this customer sees it. Nothing you click there is saved."
                  >
                    <Eye className="size-4" /> Preview portal
                  </button>
                </form>
              )}
              {canEdit && portal.enabled && <PortalInviteButton customerId={customerId} people={people} />}
            </div>
          ) : undefined
        }
      />
      {!portal.enabled && (
        <p className="border-b border-slate-100 bg-slate-50 px-5 py-3 text-[15px] text-slate-700">
          Portal is off — turn it on in{" "}
          <Link href="/settings/portal" className="font-medium text-brand-700 hover:underline">
            Settings → Customer Portal
          </Link>
          .
        </p>
      )}
      <PortalAccessList customerId={customerId} rows={access.map((a) => ({ ...a, invitedAt: a.invitedAt?.toISOString() ?? null, lastVisit: a.lastVisit?.toISOString() ?? null }))} canEdit={canEdit && portal.enabled} portalUrl={portal.enabled ? portalUrl : null} />
    </Card>
  );
}
