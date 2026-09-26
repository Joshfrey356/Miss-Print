import { requirePagePermission } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { SettingsPage } from "../_components/settings-page";
import { CompanyForm } from "./form";

export const metadata = { title: "Company Profile" };

export default async function CompanyPage() {
  await requirePagePermission("settings.manage");
  const { company } = await getSettings();
  return (
    <SettingsPage title="Company Profile" subtitle="Shown on quotes, invoices, proof pages and customer emails.">
      <CompanyForm company={company} />
    </SettingsPage>
  );
}
