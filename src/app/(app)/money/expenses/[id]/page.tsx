import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { centsToInput, fmtDateTime, jobNo, today } from "@/lib/format";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getVendorSuggestions } from "@/lib/money/expenses";
import { getExpense } from "@/lib/money/queries";
import { normalizeExpensePayment } from "@/lib/money/labels";
import { ExpenseForm } from "../expense-form";

export const metadata: Metadata = { title: "Edit expense" };

export default async function EditExpensePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePagePermission("expenses.edit");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const row = await getExpense(Number(id));
  if (!row) notFound();
  const { e } = row;
  const vendors = await getVendorSuggestions();
  const fromJob = sp.from === "job" && row.jobNumber != null;
  const listHref = can(user.role, "money.view") ? "/money?tab=expenses" : "/dashboard";
  const cancelHref = fromJob ? `/jobs/${row.jobNumber}?tab=money` : listHref;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Edit expense"
        subtitle={`Added ${fmtDateTime(e.createdAt)}${row.createdByName ? ` by ${row.createdByName}` : ""}`}
        back={fromJob ? { href: cancelHref, label: jobNo(row.jobNumber!) } : { href: listHref, label: "Expenses" }}
      />
      <Card>
        <CardBody className="py-5">
          <ExpenseForm
            mode="edit"
            expenseId={e.id}
            vendors={vendors}
            backToJob={fromJob}
            cancelHref={cancelHref}
            maxDate={today(1)}
            initial={{
              vendor: e.vendorName,
              amount: centsToInput(e.amountCents),
              category: e.category,
              spentOn: e.spentOn,
              job: row.jobNumber ? jobNo(row.jobNumber) : "",
              paymentMethod: normalizeExpensePayment(e.paymentMethod) ?? "",
              notes: e.notes ?? "",
              receipt: e.receiptFileId ? { id: e.receiptFileId, name: row.receiptName ?? "Receipt" } : null,
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
