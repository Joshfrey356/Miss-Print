import { requirePagePermission } from "@/lib/auth";
import { getLocations } from "@/lib/lookups";
import { SettingsPage } from "../_components/settings-page";
import { LocationForm } from "./form";

export const metadata = { title: "Locations" };

export default async function LocationsPage() {
  await requirePagePermission("settings.manage");
  const locs = await getLocations();
  return (
    <SettingsPage title="Locations" subtitle="Where work happens. Jobs show which location owns the next step.">
      <div className="space-y-4">
        {locs.map((l) => (
          <LocationForm key={l.id} location={l} />
        ))}
      </div>
    </SettingsPage>
  );
}
