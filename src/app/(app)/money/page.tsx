import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { accounting } from "@/lib/accounting";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { invoiceFilterCounts } from "@/lib/money/queries";
import { OverviewTab } from "./_components/overview";
import { InvoicesTab } from "./_components/invoices-tab";
import { PaymentsTab } from "./_components/payments-tab";
import { ExpensesTab } from "./_components/expenses-tab";
import { ReceivablesTab } from "./_components/receivables-tab";
import { ProfitabilityTab } from "./_components/profitability-tab";
import { flatParams } from "./_components/parts";

export const metadata: Metadata = { title: "Money" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "invoices", label: "Invoices" },
  { key: "payments", label: "Payments" },
  { key: "expenses", label: "Expenses" },
  { key: "receivables", label: "Receivables" },
  { key: "profitability", label: "Profitability" },
] as const;

export default async function MoneyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePagePermission("money.view");
  const params = flatParams(await searchParams);
  const canMargins = can(user.role, "margins.view");
  const tabs = TABS.filter((t) => t.key !== "profitability" || canMargins);
  const tab = tabs.find((t) => t.key === params.tab)?.key ?? "overview";
  const counts = await invoiceFilterCounts(user.tenantId);
  const acct = accounting();

  return (
    <div>
      <PageHeader
        title="Money"
        subtitle="Invoices, payments, expenses and what's still owed."
        actions={
          can(user.role, "expenses.edit") && (
            <LinkButton href="/money/expenses/new" variant="primary">
              <Plus className="size-4" />
              New expense
            </LinkButton>
          )
        }
      />
      <LinkTabs
        active={tab}
        tabs={tabs.map((t) => ({
          key: t.key,
          label: t.label,
          href: t.key === "overview" ? "/money" : `/money?tab=${t.key}`,
          count: t.key === "receivables" ? counts.overdue : undefined,
        }))}
      />
      {tab === "overview" && <OverviewTab tenantId={user.tenantId} canEdit={can(user.role, "money.edit")} canMargins={canMargins} />}
      {tab === "invoices" && <InvoicesTab tenantId={user.tenantId} params={params} />}
      {tab === "payments" && <PaymentsTab tenantId={user.tenantId} params={params} canVoid={can(user.role, "money.void")} />}
      {tab === "expenses" && <ExpensesTab tenantId={user.tenantId} params={params} canEdit={can(user.role, "expenses.edit")} />}
      {tab === "receivables" && <ReceivablesTab tenantId={user.tenantId} params={params} canEdit={can(user.role, "money.edit")} />}
      {tab === "profitability" && <ProfitabilityTab tenantId={user.tenantId} params={params} />}

      <p className="mt-8 text-center text-sm text-slate-400">
        {acct.name === "none"
          ? "QuickBooks sync: not connected. QuickBooks stays your official books; export CSVs for your bookkeeper any time."
          : `Accounting sync: ${acct.name}`}
      </p>
    </div>
  );
}
