import { requirePagePermission } from "@/lib/auth";
import { listEquipment, listOperations } from "@/lib/estimating/catalog";
import { SettingsPage } from "../_components/settings-page";
import { AddServiceButton, ServiceList } from "./services-client";

export const metadata = { title: "Bindery & Services" };

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requirePagePermission("pricing.edit");
  const showAll = (await searchParams).show === "all";
  const [rows, machines] = await Promise.all([listOperations(user.tenantId), listEquipment(user.tenantId)]);
  const equipment = machines.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name }));
  return (
    <SettingsPage
      wide
      title="Bindery & Services"
      subtitle="Cutting, folding, scoring, stitching, laminating, file prep… what each costs and how it's charged. Pick them on an estimate, or add them to a category so they're always included."
      actions={<AddServiceButton equipment={equipment} />}
    >
      <ServiceList rows={rows.filter((r) => showAll || r.active)} inactiveCount={rows.filter((r) => !r.active).length} showAll={showAll} equipment={equipment} />
    </SettingsPage>
  );
}
