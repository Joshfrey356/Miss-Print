import type { Metadata } from "next";
import { getBrand } from "@/lib/brand";
import { getSettings } from "@/lib/settings";
import { getPortalAccounts, requirePortal } from "@/lib/portal/session";
import { portalCounts } from "@/lib/portal/queries";
import { PortalShell } from "@/components/portal/portal-shell";
import { getPortalSettings } from "@/lib/portal/settings";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const accounts = await getPortalAccounts();
  const shop = accounts[0]?.shopName ?? "Customer portal";
  return { title: { template: `%s · ${shop}`, absolute: shop }, robots: { index: false, follow: false } };
}

/** Signed-in customer portal: branded for the shop the customer belongs to. */
export default async function PortalAccountLayout({ children }: { children: React.ReactNode }) {
  const s = await requirePortal();
  const [brand, { company }, accounts, counts, portal] = await Promise.all([getBrand(s.tenantId), getSettings(s.tenantId), getPortalAccounts(), portalCounts(s), getPortalSettings(s.tenantId)]);
  const f = portal.features;
  const others = accounts.slice(1).map((a) => ({ key: a.id.slice(0, 24), label: `${a.customerName} · ${a.shopName}` }));
  return (
    <PortalShell brand={brand} company={company} session={s} accounts={others} counts={{ ...counts, quotes: f.quotes ? counts.quotes : 0 }} askHref={f.quoteRequests ? "/portal/request" : f.messages ? "/portal/message" : null}>
      {children}
    </PortalShell>
  );
}
