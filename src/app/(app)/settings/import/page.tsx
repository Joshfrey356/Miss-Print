import { requirePagePermission } from "@/lib/auth";
import { getUsers } from "@/lib/lookups";
import { importCategories, listImports, type ImportSummary } from "@/lib/import/server";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { SettingsPage } from "../_components/settings-page";
import { ImportWizard } from "./import-wizard";
import { ImportHistory, type HistoryRow } from "./import-history";

export const metadata = { title: "Import Data" };

export default async function ImportPage() {
  const user = await requirePagePermission("settings.manage");
  const [categories, history, people] = await Promise.all([importCategories(user.tenantId), listImports(user.tenantId), getUsers(user.tenantId)]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const rows: HistoryRow[] = history.map((h) => {
    const s = h.summary as ImportSummary;
    return {
      id: h.id,
      kind: h.kind,
      filename: h.filename,
      created: s.created,
      updated: s.updated,
      skipped: s.skipped,
      errors: s.errors.length,
      extraCreated: (s.extra?.customersCreated ?? 0) + (s.extra?.vendorsCreated ?? 0) + (h.kind === "customers" ? (s.extra?.contactsCreated ?? 0) : 0),
      by: h.createdBy ? (nameOf.get(h.createdBy) ?? null) : null,
      at: h.createdAt.toISOString(),
      undoneAt: h.undoneAt?.toISOString() ?? null,
      undoneBy: h.undoneBy ? (nameOf.get(h.undoneBy) ?? null) : null,
    };
  });

  return (
    <SettingsPage
      wide
      title="Import data"
      subtitle="Bring your customers, contacts, job history, paper and vendors over from Printer's Plan — or from any spreadsheet."
    >
      <ImportWizard
        categories={categories}
        help={
          <Card>
            <CardHeader title="Getting data out of Printer's Plan" />
            <CardBody className="space-y-3 text-[15px] leading-relaxed text-slate-700">
              <p>
                In Printer&apos;s Plan, open the list or report you want — for example the <strong>customer list</strong>, <strong>contacts</strong>, or{" "}
                <strong>job / invoice history</strong> for the last few years — and use its <strong>Export</strong> (or Print → Save to file) option to save it
                as <strong>Excel</strong> or <strong>CSV</strong>.
              </p>
              <p>Any spreadsheet works, as long as the first row has column names. Extra columns are fine — you choose what to bring in.</p>
              <p className="text-sm text-slate-500">
                Suggested order: customers → contacts → past jobs. Paper and vendors can go in any time. Importing the same file twice won&apos;t make
                duplicates.
              </p>
              <p className="text-sm text-slate-500">Past jobs come in as completed history for price lookups. Invoices and payments stay in QuickBooks.</p>
            </CardBody>
          </Card>
        }
      />
      <div className="mt-8">
        <ImportHistory rows={rows} />
      </div>
    </SettingsPage>
  );
}
