import { requirePagePermission } from "@/lib/auth";
import { getLocations } from "@/lib/lookups";
import { SettingsPage } from "../_components/settings-page";
import { AddLocationForm, LocationForm } from "./form";

export const metadata = { title: "Locations" };

export default async function LocationsPage() {
  const user = await requirePagePermission("settings.manage");
  const locs = await getLocations(user.tenantId);
  return (
    <SettingsPage title="Locations" subtitle="Where work happens. Jobs show which location owns the next step.">
      <div className="space-y-4">
        {locs.map((l) => (
          <LocationForm key={l.id} location={l} />
        ))}
        <AddLocationForm />
      </div>
    </SettingsPage>
  );
}
