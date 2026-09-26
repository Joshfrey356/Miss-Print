import { requirePagePermission } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { SettingsPage } from "../_components/settings-page";
import { BusinessRulesForm } from "./form";

export const metadata = { title: "Business Rules" };

export default async function BusinessRulesPage() {
  await requirePagePermission("settings.manage");
  const { rules, quoteValidDays } = await getSettings();
  return (
    <SettingsPage
      title="Business Rules"
      subtitle="The numbers every quote starts from. Change them here and every new quote uses them — nothing is hard-coded."
    >
      <BusinessRulesForm rules={rules} quoteValidDays={quoteValidDays} />
    </SettingsPage>
  );
}
