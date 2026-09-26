import { CheckCircle2, CircleDashed, FlaskConical } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { getIntegrationStatuses } from "@/lib/admin/integrations";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SettingsPage } from "../_components/settings-page";

export const metadata = { title: "Integrations" };

const TONE: Record<string, Tone> = { connected: "green", dev: "amber", not_connected: "red", planned: "gray" };
const ICON = { connected: CheckCircle2, dev: FlaskConical, not_connected: CircleDashed, planned: CircleDashed };

export default async function IntegrationsPage() {
  await requirePagePermission("settings.manage");
  const items = getIntegrationStatuses();
  return (
    <SettingsPage
      title="Integrations"
      subtitle="Other services this app works with. Connection keys are kept in the server's settings, never shown here."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((i) => {
          const Icon = ICON[i.state];
          return (
            <Card key={i.key} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">{i.name}</h2>
                <Badge tone={TONE[i.state]}>
                  <Icon className="size-3.5" />
                  {i.state === "connected" ? "Working" : i.state === "dev" ? "Test mode" : i.state === "planned" ? "Planned" : "Not connected"}
                </Badge>
              </div>
              <p className="mt-1 text-[15px] text-slate-600">{i.what}</p>
              <p className="mt-3 text-[15px] font-medium text-slate-800">{i.stateLabel}</p>
              {i.details.map((d) => (
                <p key={d} className="mt-1 text-sm text-slate-500">
                  {d}
                </p>
              ))}
            </Card>
          );
        })}
      </div>
    </SettingsPage>
  );
}
