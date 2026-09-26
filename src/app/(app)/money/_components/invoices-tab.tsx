import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { Pagination, SortTh, Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { InvoiceStatusBadge } from "@/components/status";
import { Chips, withParams } from "@/components/chips";
import { SearchInput } from "@/components/search-input";
import { fmtDate, invoiceNo, jobNo, money, today } from "@/lib/format";
import { invoiceFilterCounts, listInvoices, PAGE_SIZE } from "@/lib/money/queries";
import { isInvoiceOverdue } from "@/lib/money/service";
import { filterInput, FilterLabel, KeepParams, Num, type SP } from "./parts";

const EMPTY: Record<string, string> = {
  unpaid: "No unpaid invoices. Everyone's paid up.",
  overdue: "Nothing is overdue.",
  paid: "No paid invoices match.",
  void: "No voided invoices.",
  all: "No invoices match.",
};

export async function InvoicesTab({ tenantId, params }: { tenantId: number; params: SP }) {
  const [data, counts] = await Promise.all([listInvoices(tenantId, params), invoiceFilterCounts(tenantId)]);
  const now = today();
  const p = { ...params, tab: "invoices" };
  const chip = (key: string, label: string, count?: number, tone?: "red") => ({ key, label, count, tone, href: withParams("/money", p, { status: key === "all" ? undefined : key, page: undefined }) });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <Chips
          active={data.status}
          items={[chip("all", "All"), chip("unpaid", "Unpaid", counts.unpaid), chip("overdue", "Overdue", counts.overdue, "red"), chip("paid", "Paid"), chip("void", "Void")]}
        />
        <div className="flex flex-wrap items-end gap-2">
          <SearchInput placeholder="Customer, INV-7001, MP-10428, PO…" className="w-full sm:w-80" />
          <form className="flex items-end gap-2">
            <KeepParams params={p} omit={["from", "to"]} />
            <FilterLabel label="Issued from">
              <input type="date" name="from" defaultValue={params.from} className={filterInput} />
            </FilterLabel>
            <FilterLabel label="to">
              <input type="date" name="to" defaultValue={params.to} className={filterInput} />
            </FilterLabel>
            <button className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Apply</button>
          </form>
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-sm text-slate-600">
          <span>
            <strong className="text-slate-900">{data.total}</strong> invoice{data.total === 1 ? "" : "s"} · Total <Num className="font-medium text-slate-900">{money(data.sumTotal)}</Num> · Balance due{" "}
            <Num className="font-medium text-slate-900">{money(data.sumBalance)}</Num>
          </span>
          <LinkButton size="sm" href={withParams("/money/export", p, { type: "invoices", tab: undefined, page: undefined })} prefetch={false}>
            <Download className="size-4" />
            Export CSV
          </LinkButton>
        </div>
        {data.rows.length === 0 ? (
          <EmptyState icon={FileText} title={EMPTY[data.status] ?? EMPTY.all} description={params.q ? `Nothing found for "${params.q}".` : undefined} />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <SortTh label="Invoice" field="number" sort={data.sort} dir={data.dir} params={p} />
                  <SortTh label="Customer" field="customer" sort={data.sort} dir={data.dir} params={p} />
                  <Th>Job</Th>
                  <SortTh label="Issued" field="issued" sort={data.sort} dir={data.dir} params={p} />
                  <SortTh label="Due" field="due" sort={data.sort} dir={data.dir} params={p} />
                  <SortTh label="Total" field="total" sort={data.sort} dir={data.dir} params={p} className="text-right" />
                  <SortTh label="Balance" field="balance" sort={data.sort} dir={data.dir} params={p} className="text-right" />
                  <Th>Status</Th>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((r) => {
                  const overdue = isInvoiceOverdue(r, now);
                  return (
                    <Tr key={r.id} className="hover:bg-slate-50/70">
                      <Td>
                        <Link href={`/money/invoices/${r.id}`} className="font-medium text-brand-700 hover:underline">
                          {invoiceNo(r.number)}
                        </Link>
                      </Td>
                      <Td className="max-w-64">
                        <Link href={`/customers/${r.customerId}`} className="block truncate text-slate-800 hover:underline">
                          {r.customerName}
                        </Link>
                      </Td>
                      <Td>
                        {r.jobNumber ? (
                          <Link href={`/jobs/${r.jobNumber}`} className="text-slate-600 hover:underline" title={r.jobTitle ?? undefined}>
                            {jobNo(r.jobNumber)}
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-slate-600">{fmtDate(r.issueDate, { weekday: false, year: true })}</Td>
                      <Td className={`whitespace-nowrap ${overdue ? "font-medium text-red-700" : "text-slate-600"}`}>{fmtDate(r.dueDate, { weekday: false, year: true })}</Td>
                      <Td className="text-right">
                        <Num>{money(r.totalCents)}</Num>
                      </Td>
                      <Td className="text-right">
                        <Num className={r.balance > 0 ? "font-semibold text-slate-900" : "text-slate-400"}>{money(r.balance)}</Num>
                      </Td>
                      <Td>
                        <InvoiceStatusBadge status={r.status} overdue={overdue} />
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={PAGE_SIZE} total={data.total} params={p} />
          </>
        )}
      </Card>
    </div>
  );
}
