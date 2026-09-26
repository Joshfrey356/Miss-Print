import Link from "next/link";
import { TrendingDown } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, SortTh, Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { Chips, withParams } from "@/components/chips";
import { cn } from "@/lib/utils";
import { addDays, fmtDate, jobNo, money, moneyShort, pct, plural, today } from "@/lib/format";
import { getProfitability, PAGE_SIZE } from "@/lib/money/queries";
import { LOW_MARGIN } from "@/lib/money/labels";
import { marginOf } from "@/lib/pricing/engine";
import { filterInput, FilterLabel, KeepParams, Num, StatCard, type SP } from "./parts";

const isYmd = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

function Margin({ v, muted }: { v: number | null; muted?: boolean }) {
  if (v == null) return <span className="text-sm text-slate-400">—</span>;
  const low = v < LOW_MARGIN;
  return <Num className={cn("font-medium", muted ? "text-slate-600" : low ? "text-red-700" : "text-emerald-700")}>{pct(v)}</Num>;
}

export async function ProfitabilityTab({ tenantId, params }: { tenantId: number; params: SP }) {
  const now = today();
  const from = isYmd(params.from) ? params.from! : addDays(now, -90);
  const to = isYmd(params.to) ? params.to! : now;
  const data = await getProfitability(tenantId, { from, to, sort: params.sort, dir: params.dir, page: params.page, low: params.low });
  const p = { ...params, tab: "profitability" };
  const s = data.summary;
  const overall = marginOf(s.revenue, s.cost);
  const quoted = marginOf(s.quotedRevenue, s.estCost);
  const range = (days: number) => withParams("/money", p, { from: addDays(now, -days), to: now, page: undefined });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form className="flex flex-wrap items-end gap-2">
          <KeepParams params={p} omit={["from", "to"]} />
          <FilterLabel label="Completed from">
            <input type="date" name="from" defaultValue={from} className={filterInput} />
          </FilterLabel>
          <FilterLabel label="to">
            <input type="date" name="to" defaultValue={to} className={filterInput} />
          </FilterLabel>
          <button className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Apply</button>
          <span className="flex gap-1 pl-1 text-sm">
            {[30, 90, 180, 365].map((d) => (
              <Link key={d} href={range(d)} className="rounded-md px-2 py-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                {d === 365 ? "1 yr" : `${d}d`}
              </Link>
            ))}
          </span>
        </form>
        <Chips
          active={params.low === "1" ? "low" : "all"}
          items={[
            { key: "all", label: "All jobs", href: withParams("/money", p, { low: undefined, page: undefined }) },
            { key: "low", label: `Under ${pct(LOW_MARGIN)} margin`, count: s.lowCount, tone: "red", href: withParams("/money", p, { low: "1", page: undefined }) },
          ]}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Revenue" value={moneyShort(s.revenue)} sub={`${plural(s.jobs, "completed job")} · before tax`} />
        <StatCard label="Actual cost" value={moneyShort(s.cost)} sub="expenses + labor" />
        <StatCard label="Actual margin" value={pct(overall)} sub={quoted != null ? `Quoted: ${pct(quoted)}` : undefined} tone={overall != null && overall < LOW_MARGIN ? "red" : "green"} />
        <StatCard label="Low-margin jobs" value={s.lowCount} sub={`under ${pct(LOW_MARGIN)}${s.noCostCount ? ` · ${s.noCostCount} with no costs logged` : ""}`} tone={s.lowCount ? "red" : "default"} />
      </div>

      {s.jobs === 0 ? (
        <Card>
          <EmptyState icon={TrendingDown} title="No completed jobs in this date range." description="Try a longer range." />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title="By product category" description="Where are we underpricing? Lowest margin first. Jobs without any costs logged are left out of the margin." />
            <Table>
              <THead>
                <tr>
                  <Th>Category</Th>
                  <Th className="text-right">Jobs</Th>
                  <Th className="text-right">Revenue</Th>
                  <Th className="text-right">Actual cost</Th>
                  <Th className="text-right">Quoted margin</Th>
                  <Th className="text-right">Actual margin</Th>
                  <Th className="text-right">Low-margin jobs</Th>
                </tr>
              </THead>
              <tbody>
                {data.categories.map((c) => (
                  <Tr key={c.categoryName} className={c.margin != null && c.margin < LOW_MARGIN ? "bg-red-50/60" : undefined}>
                    <Td className="font-medium text-slate-800">{c.categoryName}</Td>
                    <Td className="text-right">{c.jobs}</Td>
                    <Td className="text-right">
                      <Num>{money(c.revenue, { cents: false })}</Num>
                    </Td>
                    <Td className="text-right">
                      <Num>{money(c.cost, { cents: false })}</Num>
                    </Td>
                    <Td className="text-right">
                      <Margin v={c.quotedMargin} muted />
                    </Td>
                    <Td className="text-right">
                      <Margin v={c.margin} />
                    </Td>
                    <Td className="text-right">{c.lowCount ? <span className="font-medium text-red-700">{c.lowCount}</span> : <span className="text-slate-400">0</span>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card>
            <CardHeader
              title="Jobs"
              description={`Actual cost = job expenses + labor hours × ${money(data.rate)}/hr. Rows under ${pct(LOW_MARGIN)} actual margin are highlighted.`}
            />
            {data.rows.length === 0 ? (
              <EmptyState compact title={`No jobs under ${pct(LOW_MARGIN)} margin in this range.`} />
            ) : (
              <>
                <Table>
                  <THead>
                    <tr>
                      <Th>Job</Th>
                      <Th>Customer</Th>
                      <SortTh label="Completed" field="completed" sort={data.sort} dir={data.dir} params={p} />
                      <SortTh label="Revenue" field="revenue" sort={data.sort} dir={data.dir} params={p} className="text-right" />
                      <Th className="text-right">Est. cost</Th>
                      <Th className="text-right">Actual cost</Th>
                      <SortTh label="Quoted margin" field="quoted" sort={data.sort} dir={data.dir} params={p} className="text-right" />
                      <SortTh label="Actual margin" field="margin" sort={data.sort} dir={data.dir} params={p} className="text-right" />
                      <SortTh label="Profit" field="profit" sort={data.sort} dir={data.dir} params={p} className="text-right" />
                    </tr>
                  </THead>
                  <tbody>
                    {data.rows.map((r) => {
                      const low = r.actualMargin != null && r.actualMargin < LOW_MARGIN;
                      return (
                        <Tr key={r.id} className={low ? "bg-red-50/60" : "hover:bg-slate-50/70"}>
                          <Td className="max-w-72">
                            <Link href={`/jobs/${r.number}?tab=money`} className="font-medium text-brand-700 hover:underline">
                              {jobNo(r.number)}
                            </Link>
                            <span className="block truncate text-sm text-slate-600">
                              {r.title}
                              {r.categoryName ? ` · ${r.categoryName}` : ""}
                            </span>
                          </Td>
                          <Td className="max-w-52">
                            <Link href={`/customers/${r.customerId}`} className="block truncate text-slate-700 hover:underline">
                              {r.customerName}
                            </Link>
                          </Td>
                          <Td className="whitespace-nowrap text-slate-600">{fmtDate(r.completedOn, { weekday: false })}</Td>
                          <Td className="text-right">
                            <Num>{money(r.revenue)}</Num>
                          </Td>
                          <Td className="text-right">
                            <Num className="text-slate-600">{money(r.estCost)}</Num>
                          </Td>
                          <Td className="text-right">
                            {r.actualCost > 0 ? (
                              <Num title={`Expenses ${money(r.expenseCost)} + labor ${money(r.laborCost)}`}>{money(r.actualCost)}</Num>
                            ) : (
                              <span className="text-sm text-slate-400">No costs logged</span>
                            )}
                          </Td>
                          <Td className="text-right">
                            <Margin v={r.quotedMargin} muted />
                          </Td>
                          <Td className="text-right">
                            <Margin v={r.actualMargin} />
                          </Td>
                          <Td className="text-right">
                            {r.actualCost > 0 ? <Num className={r.revenue - r.actualCost < 0 ? "font-medium text-red-700" : ""}>{money(r.revenue - r.actualCost)}</Num> : <span className="text-slate-400">—</span>}
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
                <Pagination page={data.page} pageSize={PAGE_SIZE} total={s.filtered} params={p} />
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
