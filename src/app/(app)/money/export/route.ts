import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { invoiceNo, jobNo, today } from "@/lib/format";
import { listExpenses, listInvoices, listPayments } from "@/lib/money/queries";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, expensePaymentLabel, PAYMENT_METHOD_LABELS } from "@/lib/money/labels";
import { csvMoney, toCsv } from "@/lib/money/csv";
import { getTenant } from "@/lib/tenant";

const STATUS: Record<string, string> = { draft: "Draft", sent: "Unpaid", partial: "Partially paid", paid: "Paid", void: "Void" };

/** CSV export of the current Money filter (for the bookkeeper / QuickBooks import). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!can(user.role, "money.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const type = params.type ?? "invoices";
  const now = today();
  let csv: string;

  if (type === "invoices") {
    const { rows } = await listInvoices(user.tenantId, params, { all: true });
    csv = toCsv(
      ["Invoice", "Customer", "Job", "Job title", "PO", "Issue date", "Due date", "Status", "Subtotal", "Tax", "Total", "Paid", "Balance", "QuickBooks ID"],
      rows.map((r) => [
        invoiceNo(r.number),
        r.customerName,
        r.jobNumber ? jobNo(r.jobNumber) : "",
        r.jobTitle ?? "",
        r.poNumber ?? "",
        r.issueDate,
        r.dueDate,
        (r.status === "sent" || r.status === "partial") && r.dueDate < now ? "Overdue" : STATUS[r.status],
        csvMoney(r.subtotalCents),
        csvMoney(r.taxCents),
        csvMoney(r.totalCents),
        csvMoney(r.paidCents),
        csvMoney(r.balance),
        r.externalId ?? "",
      ]),
    );
  } else if (type === "expenses") {
    const { rows } = await listExpenses(user.tenantId, params, { all: true, categories: EXPENSE_CATEGORIES });
    csv = toCsv(
      ["Date", "Vendor", "Category", "Amount", "Job", "Job title", "Paid with", "Notes", "Receipt", "QuickBooks ID"],
      rows.map((r) => [
        r.spentOn,
        r.vendorName,
        EXPENSE_CATEGORY_LABELS[r.category],
        csvMoney(r.amountCents),
        r.jobNumber ? jobNo(r.jobNumber) : "",
        r.jobTitle ?? "",
        r.paymentMethod ? expensePaymentLabel(r.paymentMethod) : "",
        r.notes ?? "",
        r.receiptFileId ? `${url.origin}/api/files/${r.receiptFileId}` : "",
        r.externalId ?? "",
      ]),
    );
  } else if (type === "payments") {
    const { rows } = await listPayments(user.tenantId, params, { all: true });
    csv = toCsv(
      ["Received", "Customer", "Invoice", "Method", "Reference", "Amount", "Voided", "Notes"],
      rows.map((r) => [r.receivedOn, r.customerName, invoiceNo(r.invoiceNumber), PAYMENT_METHOD_LABELS[r.method], r.reference ?? "", csvMoney(r.amountCents), r.voidedAt ? "Yes" : "", r.notes ?? ""]),
    );
  } else {
    return NextResponse.json({ error: "Unknown export type" }, { status: 400 });
  }

  const shop = await getTenant(user.tenantId);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${shop?.slug ?? "shop"}-${type}-${now}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
