import { requirePagePermission } from "@/lib/auth";
import { listPaperStocks, listVendors } from "@/lib/estimating/catalog";
import { SettingsPage } from "../_components/settings-page";
import { AddPaperButton, PaperList } from "./paper-client";

export const metadata = { title: "Paper & Stock" };

export default async function PaperPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requirePagePermission("pricing.edit");
  const showAll = (await searchParams).show === "all";
  const [rows, vendorRows] = await Promise.all([listPaperStocks(user.tenantId), listVendors(user.tenantId)]);
  const vendors = vendorRows.filter((v) => !v.archivedAt).map((v) => ({ id: v.id, name: v.name }));
  return (
    <SettingsPage
      wide
      title="Paper & Stock"
      subtitle="The paper you print on, the sheet size you buy it in, and what 1,000 sheets cost you. Estimates use these to price paper."
      actions={<AddPaperButton vendors={vendors} />}
    >
      <PaperList
        rows={rows.filter((r) => showAll || r.active)}
        inactiveCount={rows.filter((r) => !r.active).length}
        showAll={showAll}
        vendors={vendors}
      />
    </SettingsPage>
  );
}
