import { requirePagePermission } from "@/lib/auth";
import { appUrl } from "@/lib/http";
import { getTenant } from "@/lib/tenant";
import { getStripeStatus } from "@/lib/payments/connection";
import { getPortalSettings } from "@/lib/portal/settings";
import { SettingsPage } from "../_components/settings-page";
import { PortalSettingsForm } from "./form";

export const metadata = { title: "Customer Portal" };

export default async function PortalSettingsPage() {
  const user = await requirePagePermission("settings.manage");
  const [portal, tenant, stripe, base] = await Promise.all([getPortalSettings(user.tenantId), getTenant(user.tenantId), getStripeStatus(user.tenantId), appUrl()]);
  const address = `${base}/portal${tenant ? `?shop=${tenant.slug}` : ""}`;
  return (
    <SettingsPage title="Customer Portal" subtitle="A private website, with your name and logo, where customers check orders, approve proofs, accept quotes, pay and reorder.">
      <PortalSettingsForm settings={portal} address={address} stripeConnected={stripe.connected} />
    </SettingsPage>
  );
}
