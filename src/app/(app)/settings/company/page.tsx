import { requirePagePermission } from "@/lib/auth";
import { getBrand } from "@/lib/brand";
import { getSettings } from "@/lib/settings";
import { SettingsPage } from "../_components/settings-page";
import { CompanyForm, LogoForm } from "./form";

export const metadata = { title: "Company Profile" };

export default async function CompanyPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const user = await requirePagePermission("settings.manage");
  const [{ company }, brand, { welcome }] = await Promise.all([getSettings(user.tenantId), getBrand(user.tenantId), searchParams]);
  return (
    <SettingsPage title="Company Profile" subtitle="Your name and logo are shown across the app, on quotes, invoices, proof pages and customer emails.">
      <div className="space-y-4">
        {welcome && (
          <div className="rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-[15px] text-brand-900">
            <p className="font-semibold">Welcome — your shop is ready.</p>
            <p className="mt-1">
              Add your logo and contact details below. Then check <strong>Business Rules</strong> (sales tax, rates), <strong>Pricing</strong> and{" "}
              <strong>Team</strong> to invite your people.
            </p>
          </div>
        )}
        <LogoForm brand={brand} />
        <CompanyForm company={company} />
      </div>
    </SettingsPage>
  );
}
