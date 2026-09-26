import Link from "next/link";
import { Download, Wallet } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { withParams } from "@/components/chips";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { SearchInput } from "@/components/search-input";
import { fmtDate, invoiceNo, money } from "@/lib/format";
import { listPayments, PAGE_SIZE } from "@/lib/money/queries";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/lib/money/labels";
import { VoidButton } from "./client";
import { filterInput, FilterLabel, KeepParams, Num, type SP } from "./parts";

export async function PaymentsTab({ params, canVoid }: { params: SP; canVoid: boolean }) {
  const data = await listPayments(params);
  const p = { ...params, tab: "payments" };
  const filtered = !!(params.method || params.from || params.to || params.q);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <SearchInput placeholder="Customer, check #, INV-7001…" className="w-full sm:w-72" />
        <form className="flex flex-wrap items-end gap-2">
          <KeepParams params={p} omit={["method", "from", "to", "voided"]} />
          <AutoSubmitSelect name="method" label="Method" value={params.method} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
          <FilterLabel label="Received from">
            <input type="date" name="from" defaultValue={params.from} className={filterInput} />
          </FilterLabel>
          <FilterLabel label="to">
            <input type="date" name="to" defaultValue={params.to} className={filterInput} />
          </FilterLabel>
          <label className="flex h-9 items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" name="voided" value="1" defaultChecked={params.voided === "1"} className="size-4 accent-brand-500" />
            Show voided
          </label>
          <button className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Apply</button>
          {filtered && (
            <Link href="/money?tab=payments" className="h-9 px-2 text-sm leading-9 text-slate-500 hover:text-slate-800">
              Clear
            </Link>
          )}
        </form>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-sm text-slate-600">
          <span>
            <strong className="text-slate-900">{data.total}</strong> payment{data.total === 1 ? "" : "s"} · <Num className="font-medium text-slate-900">{money(data.sum)}</Num> collected
          </span>
          <LinkButton size="sm" href={withParams("/money/export", p, { type: "payments", tab: undefined, page: undefined })} prefetch={false}>
            <Download className="size-4" />
            Export CSV
          </LinkButton>
        </div>
        {data.rows.length === 0 ? (
          <EmptyState icon={Wallet} title={filtered ? "No payments match these filters." : "No payments recorded yet."} description="Payments are recorded from an invoice." />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>Received</Th>
                  <Th>Customer</Th>
                  <Th>Invoice</Th>
                  <Th>Method</Th>
                  <Th>Reference</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Recorded by</Th>
                  {canVoid && <Th />}
                </tr>
              </THead>
              <tbody>
                {data.rows.map((r) => (
                  <Tr key={r.id} className={r.voidedAt ? "bg-slate-50 text-slate-400" : "hover:bg-slate-50/70"}>
                    <Td className="whitespace-nowrap">{fmtDate(r.receivedOn, { weekday: false, year: true })}</Td>
                    <Td className="max-w-64">
                      <Link href={`/customers/${r.customerId}`} className="block truncate hover:underline">
                        {r.customerName}
                      </Link>
                    </Td>
                    <Td>
                      <Link href={`/money/invoices/${r.invoiceId}`} className="font-medium text-brand-700 hover:underline">
                        {invoiceNo(r.invoiceNumber)}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">{PAYMENT_METHOD_LABELS[r.method]}</Td>
                    <Td className="text-slate-600">{r.reference ?? "—"}</Td>
                    <Td className="text-right">
                      <Num className={r.voidedAt ? "line-through" : "font-medium text-slate-900"}>{money(r.amountCents)}</Num>
                    </Td>
                    <Td className="whitespace-nowrap text-slate-600">{r.recordedByName ?? "—"}</Td>
                    {canVoid && (
                      <Td className="text-right">
                        {r.voidedAt ? (
                          <Badge>Void</Badge>
                        ) : (
                          <VoidButton
                            kind="payment"
                            id={r.id}
                            title="Void this payment?"
                            description={`${money(r.amountCents)} from ${r.customerName} on ${invoiceNo(r.invoiceNumber)}. The invoice balance goes back up by this amount.`}
                          />
                        )}
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
