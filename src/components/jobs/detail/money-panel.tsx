import Link from "next/link";
import { Plus, Receipt } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { InvoiceStatusBadge } from "@/components/status";
import { fmtDate, invoiceNo, money, pct } from "@/lib/format";
import { CreateInvoiceButton } from "./create-invoice-button";
import { cn } from "@/lib/utils";

type Inv = { id: number; number: number; status: "draft" | "sent" | "partial" | "paid" | "void"; totalCents: number; paidCents: number; dueDate: string; issueDate: string };
type Profit = {
  revenueCents: number;
  quotedCostCents: number;
  quotedMarginPct: number | null;
  materialCents: number;
  outsideCents: number;
  /** Breakdown of materialCents + outsideCents (src/lib/jobs/profit.ts). */
  expenseMaterialCents: number;
  expenseOutsideCents: number;
  stockUsedCents: number;
  purchaseOrderCents: number;
  otherCents: number;
  laborCents: number;
  laborHours: number;
  actualCostCents: number;
  grossProfitCents: number;
  actualMarginPct: number | null;
  hasActuals: boolean;
} | null;
type Exp = { id: number; vendorName: string; amountCents: number; category: string; spentOn: string; receiptFileId: number | null };

export function MoneyPanel({
  jobId,
  jobNumber,
  invoices,
  profit,
  expenses,
  canInvoice,
  canSeeCost,
  canAddExpense,
  today,
}: {
  jobId: number;
  jobNumber: number;
  invoices: Inv[];
  profit: Profit;
  expenses: Exp[];
  canInvoice: boolean;
  canSeeCost: boolean;
  canAddExpense: boolean;
  today: string;
}) {
  const active = invoices.filter((i) => i.status !== "void");
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Invoice" action={canInvoice && active.length === 0 ? <CreateInvoiceButton jobId={jobId} /> : undefined} />
        <CardBody>
          {invoices.length === 0 ? (
            <p className="text-sm text-slate-500">Not invoiced yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {invoices.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="flex items-center gap-3">
                    <Link href={`/money/invoices/${i.id}`} className="font-medium text-brand-700 hover:underline">
                      {invoiceNo(i.number)}
                    </Link>
                    <InvoiceStatusBadge status={i.status} overdue={i.dueDate < today} />
                  </div>
                  <div className="tabular text-right text-sm">
                    <span className="font-semibold">{money(i.totalCents)}</span>
                    {i.status !== "paid" && i.status !== "void" && <span className="ml-2 text-slate-500">balance {money(i.totalCents - i.paidCents)} · due {fmtDate(i.dueDate)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {canSeeCost && profit && (
        <Card>
          <CardHeader title="Job profit" description="Quoted margin vs. what it actually cost us." />
          <CardBody>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Revenue" value={money(profit.revenueCents)} />
              <Stat label="Actual cost" value={profit.hasActuals ? money(profit.actualCostCents) : "—"} />
              <Stat label="Quoted margin" value={pct(profit.quotedMarginPct)} />
              <Stat
                label="Actual margin"
                value={profit.hasActuals ? pct(profit.actualMarginPct) : "No costs yet"}
                tone={profit.actualMarginPct != null && profit.quotedMarginPct != null ? (profit.actualMarginPct < profit.quotedMarginPct - 0.05 ? "bad" : "good") : undefined}
              />
            </div>
            {profit.hasActuals && (
              <dl className="tabular mt-4 grid grid-cols-[1fr_auto] gap-y-1 border-t border-slate-100 pt-3 text-sm">
                {profit.stockUsedCents > 0 && (
                  <>
                    <dt className="text-slate-500">
                      Stock used <span className="text-slate-400">(at our cost)</span>
                    </dt>
                    <dd>{money(profit.stockUsedCents)}</dd>
                  </>
                )}
                {profit.purchaseOrderCents > 0 && (
                  <>
                    <dt className="text-slate-500">
                      Purchase orders{" "}
                      <span className="text-slate-400">(bought for this job)</span>
                    </dt>
                    <dd>{money(profit.purchaseOrderCents)}</dd>
                  </>
                )}
                {(profit.expenseMaterialCents > 0 || (profit.stockUsedCents === 0 && profit.purchaseOrderCents === 0)) && (
                  <>
                    <dt className="text-slate-500">Materials (expenses)</dt>
                    <dd>{money(profit.expenseMaterialCents)}</dd>
                  </>
                )}
                {(profit.expenseOutsideCents > 0 || (profit.stockUsedCents === 0 && profit.purchaseOrderCents === 0)) && (
                  <>
                    <dt className="text-slate-500">Outside vendors / install (expenses)</dt>
                    <dd>{money(profit.expenseOutsideCents)}</dd>
                  </>
                )}
                <dt className="text-slate-500">Labor ({profit.laborHours} hr)</dt>
                <dd>{money(profit.laborCents)}</dd>
                {profit.otherCents > 0 && (
                  <>
                    <dt className="text-slate-500">Other</dt>
                    <dd>{money(profit.otherCents)}</dd>
                  </>
                )}
                <dt className="font-semibold text-slate-900">Gross profit</dt>
                <dd className={cn("font-semibold", profit.grossProfitCents < 0 ? "text-red-600" : "text-slate-900")}>{money(profit.grossProfitCents)}</dd>
              </dl>
            )}
          </CardBody>
        </Card>
      )}

      {canSeeCost && (
        <Card>
          <CardHeader
            title="Costs attached to this job"
            action={
              canAddExpense ? (
                <LinkButton size="sm" href={`/money/expenses/new?job=${jobNumber}`}>
                  <Plus className="size-4" /> Add expense
                </LinkButton>
              ) : undefined
            }
          />
          <CardBody>
            {expenses.length === 0 ? (
              <p className="text-sm text-slate-500">
                {profit && (profit.stockUsedCents > 0 || profit.purchaseOrderCents > 0)
                  ? `No other expenses attached. ${
                      profit.stockUsedCents > 0 && profit.purchaseOrderCents > 0
                        ? "Stock used and purchase orders for this job are"
                        : profit.stockUsedCents > 0
                          ? "Stock used on this job is"
                          : "Purchase orders for this job are"
                    } already counted above.`
                  : "No expenses attached. Add material and vendor costs to see the real profit."}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {expenses.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div>
                      <span className="font-medium text-slate-800">{e.vendorName}</span>
                      <span className="ml-2 text-slate-500">
                        {e.category.replace("_", " ")} · {fmtDate(e.spentOn)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {e.receiptFileId && (
                        <a href={`/api/files/${e.receiptFileId}`} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-brand-600" aria-label="Receipt">
                          <Receipt className="size-4" />
                        </a>
                      )}
                      <span className="tabular font-medium">{money(e.amountCents)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn("tabular mt-1 text-xl font-semibold", tone === "bad" ? "text-red-600" : tone === "good" ? "text-emerald-700" : "text-slate-900")}>{value}</p>
    </div>
  );
}
