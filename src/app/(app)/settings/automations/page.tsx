import { Clock } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { PLANNED_EMAIL_TEMPLATES } from "@/lib/admin/email-templates";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { SettingsPage } from "../_components/settings-page";
import { AutomationsForm } from "./form";

export const metadata = { title: "Customer Messages & Automations" };

export default async function AutomationsPage() {
  const user = await requirePagePermission("settings.manage");
  const { automations } = await getSettings(user.tenantId);
  return (
    <SettingsPage title="Customer Messages & Automations" subtitle="Reminders and follow-ups the system could send for you.">
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
        <Clock className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-semibold">Coming in Phase 2 — nothing is sent automatically yet.</p>
          <p className="mt-0.5 text-sm">
            You can set these up now so they&apos;re ready. Until Phase 2, every email to a customer is sent by a person, from the quote, proof or invoice.
          </p>
        </div>
      </div>
      <AutomationsForm automations={automations} />
      <Card className="mt-6">
        <CardHeader title="Customer email templates" description="Planned messages. Each will be editable here, in your own words, before anything is sent." />
        <ul className="divide-y divide-slate-100">
          {PLANNED_EMAIL_TEMPLATES.map((t) => (
            <li key={t.key} className="flex items-start justify-between gap-3 px-5 py-3">
              <div>
                <p className="font-medium text-slate-900">{t.name}</p>
                <p className="text-sm text-slate-500">{t.when}</p>
              </div>
              <Badge>Planned</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </SettingsPage>
  );
}
