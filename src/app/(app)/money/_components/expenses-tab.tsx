import Link from "next/link";
import { Download, Paperclip, Receipt } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { Pagination, Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { SearchInput } from "@/components/search-input";
import { withParams } from "@/components/chips";
import { fmtDate, jobNo, money } from "@/lib/format";
import { listExpenses, PAGE_SIZE } from "@/lib/money/queries";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, expensePaymentLabel } from "@/lib/money/labels";
import { filterInput, FilterLabel, KeepParams, Num, type SP } from "./parts";

export async function ExpensesTab({ tenantId, params, canEdit }: { tenantId: number; params: SP; canEdit: boolean }) {
  const data = await listExpenses(tenantId, params, { categories: EXPENSE_CATEGORIES });
  const p = { ...params, tab: "expenses" };
  const filtered = !!(params.category || params.month || params.attributed || params.q);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <SearchInput placeholder="Vendor, notes, MP-10428…" className="w-full sm:w-72" />
        <form className="flex flex-wrap items-end gap-2">
          <KeepParams params={p} omit={["category", "month", "attributed"]} />
          <AutoSubmitSelect name="category" label="Category" value={params.category} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABELS[c] }))} />
          <AutoSubmitSelect
            name="attributed"
            label="Job"
            value={params.attributed}
            options={[
              { value: "job", label: "Job expenses" },
              { value: "overhead", label: "Overhead (no job)" },
            ]}
          />
          <FilterLabel label="Month">
            <input type="month" name="month" defaultValue={params.month} className={filterInput} />
          </FilterLabel>
          <button className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Apply</button>
          {filtered && (
            <Link href="/money?tab=expenses" className="h-9 px-2 text-sm leading-9 text-slate-500 hover:text-slate-800">
              Clear
            </Link>
          )}
        </form>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-sm text-slate-600">
          <span>
            <strong className="text-slate-900">{data.total}</strong> expense{data.total === 1 ? "" : "s"} · <Num className="font-medium text-slate-900">{money(data.sum)}</Num>
          </span>
          <div className="flex gap-2">
            <LinkButton size="sm" href={withParams("/money/export", p, { type: "expenses", tab: undefined, page: undefined })} prefetch={false}>
              <Download className="size-4" />
              Export CSV
            </LinkButton>
          </div>
        </div>
        {data.rows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={filtered ? "No expenses match these filters." : "No expenses recorded yet."}
            description="Add receipts as you go so job costs stay accurate."
            action={canEdit ? <LinkButton variant="primary" href="/money/expenses/new">New expense</LinkButton> : undefined}
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>Date</Th>
                  <Th>Vendor</Th>
                  <Th>Category</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Job</Th>
                  <Th>Paid by</Th>
                  <Th>Receipt</Th>
                  {canEdit && <Th />}
                </tr>
              </THead>
              <tbody>
                {data.rows.map((r) => (
                  <Tr key={r.id} className="hover:bg-slate-50/70">
                    <Td className="whitespace-nowrap text-slate-600">{fmtDate(r.spentOn, { weekday: false, year: true })}</Td>
                    <Td className="max-w-64">
                      <span className="block truncate font-medium text-slate-800">{r.vendorName}</span>
                      {r.notes && <span className="block truncate text-sm text-slate-500">{r.notes}</span>}
                    </Td>
                    <Td className="whitespace-nowrap">{EXPENSE_CATEGORY_LABELS[r.category]}</Td>
                    <Td className="text-right">
                      <Num className="font-medium text-slate-900">{money(r.amountCents)}</Num>
                    </Td>
                    <Td>
                      {r.jobNumber ? (
                        <Link href={`/jobs/${r.jobNumber}`} className="text-brand-700 hover:underline" title={r.jobTitle ?? undefined}>
                          {jobNo(r.jobNumber)}
                        </Link>
                      ) : (
                        <span className="text-sm text-slate-400">Overhead</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-slate-600">{expensePaymentLabel(r.paymentMethod)}</Td>
                    <Td>
                      {r.receiptFileId ? (
                        <a href={`/api/files/${r.receiptFileId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline" title={r.receiptName ?? undefined}>
                          <Paperclip className="size-3.5" />
                          View
                        </a>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </Td>
                    {canEdit && (
                      <Td className="text-right">
                        <Link href={`/money/expenses/${r.id}`} className="text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline">
                          Edit
                        </Link>
                      </Td>
                    )}
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={PAGE_SIZE} total={data.total} params={p} />
          </>
        )}
      </Card>
    </div>
  );
}
