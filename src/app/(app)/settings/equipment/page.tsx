import { requirePagePermission } from "@/lib/auth";
import { listEquipment } from "@/lib/estimating/catalog";
import { getLocations } from "@/lib/lookups";
import { SettingsPage } from "../_components/settings-page";
import { AddEquipmentButton, EquipmentList } from "./equipment-client";

export const metadata = { title: "Presses & Equipment" };

export default async function EquipmentPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requirePagePermission("pricing.edit");
  const showAll = (await searchParams).show === "all";
  const [rows, locs] = await Promise.all([listEquipment(user.tenantId), getLocations(user.tenantId)]);
  const locations = locs.filter((l) => l.code !== "OFFSITE").map((l) => ({ id: l.id, name: l.name }));
  return (
    <SettingsPage
      wide
      title="Presses & Equipment"
      subtitle="Your presses and machines. Estimates use the digital and offset presses to price printing — click charges, plates, make-ready and press time. The schedule uses the hours and days each machine runs."
      actions={<AddEquipmentButton locations={locations} />}
    >
      <EquipmentList
        rows={rows.filter((r) => showAll || r.active)}
        inactiveCount={rows.filter((r) => !r.active).length}
        activePresses={rows.filter((r) => r.active && (r.kind === "digital" || r.kind === "offset")).length}
        showAll={showAll}
        locations={locations}
      />
    </SettingsPage>
  );
}
