import Link from "next/link";
import { Archive, Plus, Search, Users, X } from "lucide-react";
import { requirePagePermission, userCan } from "@/lib/auth";
import { CUSTOMER_FILTERS, listCustomers, PAGE_SIZE, type CustomerFilter, type CustomerSort } from "@/lib/customers/queries";
import { fmtDate, money, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, SortTh, Table, Td, Th, THead } from "@/components/ui/table";
import { RowLink } from "./_components/row-link";

export const metadata = { title: "Customers" };

const SORTS: CustomerSort[] = ["name", "city", "open", "balance", "last", "revenue"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

const EMPTY: Record<CustomerFilter, string> = {
  all: "No customers yet",
  open: "No customers have open jobs right now",
  owes: "Nobody owes money right now",
  exempt: "No tax-exempt customers",
  inactive: "Every customer has ordered in the last 12 months",
};

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePagePermission("customers.view");
  const showMoney = userCan(user, "financials.view");
  const canEdit = userCan(user, "customers.edit");
  const sp = await searchParams;

  const q = one(sp.q)?.slice(0, 100);
  const filterRaw = one(sp.filter) as CustomerFilter | undefined;
  const filter: CustomerFilter = CUSTOMER_FILTERS.some((f) => f.key === filterRaw && (!f.money || showMoney)) ? filterRaw! : "all";
  const sortRaw = one(sp.sort) as CustomerSort | undefined;
  const sort = sortRaw && SORTS.includes(sortRaw) ? sortRaw : undefined;
  const dir = one(sp.dir) === "desc" ? "desc" : "asc";
  const showArchived = one(sp.archived) === "1";
  const pageNum = Math.max(1, Number(one(sp.page)) || 1);

  const { rows, total, page } = await listCustomers(user.tenantId, { q, filter, sort, dir, page: pageNum, showArchived, showMoney });

  // Current list state, for building links.
  const params: Record<string, string | undefined> = {
    q,
    filter: filter === "all" ? undefined : filter,
    sort,
    dir: sort ? dir : undefined,
    archived: showArchived ? "1" : undefined,
  };
  const href = (over: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = { ...params, page: undefined, ...over };
    const qs = new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => Boolean(e[1]))).toString();
    return qs ? `/customers?${qs}` : "/customers";
  };

  const filtered = Boolean(q) || filter !== "all";
  const emptyTitle = q ? `No customers match "${q}"` : EMPTY[filter];

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={filtered ? `${plural(total, "customer")} found` : plural(total, "customer")}
        actions={
          canEdit && (
            <LinkButton href="/customers/new" variant="primary">
              <Plus className="size-4" />
              New customer
            </LinkButton>
          )
        }
      />

      <Card>
        <div className="space-y-3 border-b border-slate-100 p-4">
          <form action="/customers" className="flex gap-2" role="search">
            {params.filter && <input type="hidden" name="filter" value={params.filter} />}
            {params.archived && <input type="hidden" name="archived" value="1" />}
            {sort && <input type="hidden" name="sort" value={sort} />}
            {sort && <input type="hidden" name="dir" value={dir} />}
            <div className="relative max-w-xl flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
              <Input
                name="q"
                type="search"
                defaultValue={q}
                placeholder="Search name, contact, phone or email"
                className="h-11 pl-10 text-base"
                aria-label="Search customers"
              />
            </div>
            <Button type="submit" size="lg" className="h-11">
              Search
            </Button>
            {q && (
              <LinkButton href={href({ q: undefined })} variant="ghost" size="lg" className="h-11 px-3" aria-label="Clear search">
                <X className="size-4" />
                <span className="hidden sm:inline">Clear</span>
              </LinkButton>
            )}
          </form>
          <div className="flex flex-wrap items-center gap-2">
            {CUSTOMER_FILTERS.filter((f) => !f.money || showMoney).map((f) => (
              <Link
                key={f.key}
                href={href({ filter: f.key === "all" ? undefined : f.key })}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                  filter === f.key ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                )}
              >
                {f.label}
              </Link>
            ))}
            <Link
              href={href({ archived: showArchived ? undefined : "1" })}
              className={cn(
                "ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium",
                showArchived ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
              )}
            >
              <Archive className="size-4" />
              {showArchived ? "Hide archived" : "Show archived"}
            </Link>
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={emptyTitle}
            description={
              filtered ? "Try a different search, or check the spelling." : canEdit ? "Add your first customer to get started." : undefined
            }
            action={
              filtered ? (
                <LinkButton href="/customers">Show all customers</LinkButton>
              ) : (
                canEdit && (
                  <LinkButton href="/customers/new" variant="primary">
                    <Plus className="size-4" />
                    New customer
                  </LinkButton>
                )
              )
            }
          />
        ) : (
          <>
            {/* Desktop / tablet table */}
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <SortTh label="Name" field="name" sort={sort} dir={dir} params={params} />
                    <SortTh label="City" field="city" sort={sort} dir={dir} params={params} />
                    <Th>Phone</Th>
                    <SortTh label="Open jobs" field="open" sort={sort} dir={dir} params={params} className="text-right" />
                    {showMoney && <SortTh label="Balance" field="balance" sort={sort} dir={dir} params={params} className="text-right" />}
                    <SortTh label="Last order" field="last" sort={sort} dir={dir} params={params} />
                    {showMoney && <SortTh label="Lifetime revenue" field="revenue" sort={sort} dir={dir} params={params} className="text-right" />}
                  </tr>
                </THead>
                <tbody>
                  {rows.map((c) => (
                    <RowLink key={c.id} href={`/customers/${c.id}`} className={c.archived ? "opacity-60" : undefined}>
                      <Td>
                        <Link href={`/customers/${c.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                          {c.name}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
                          {c.isCompany && c.primaryContact && <span>{c.primaryContact}</span>}
                          {c.taxExempt && <Badge tone="teal">Tax exempt</Badge>}
                          {c.archived && <Badge>Archived</Badge>}
                        </div>
                      </Td>
                      <Td className="text-slate-700">{c.city ?? <span className="text-slate-400">—</span>}</Td>
                      <Td className="whitespace-nowrap text-slate-700">{c.phone ?? <span className="text-slate-400">—</span>}</Td>
                      <Td className="text-right tabular">
                        {c.openJobs > 0 ? <span className="font-semibold text-slate-900">{c.openJobs}</span> : <span className="text-slate-400">0</span>}
                      </Td>
                      {showMoney && (
                        <Td className={cn("whitespace-nowrap text-right tabular", c.overdue ? "font-semibold text-red-700" : c.balance ? "text-slate-900" : "text-slate-400")}>
                          {c.balance ? money(c.balance) : "—"}
                          {c.overdue && <div className="text-xs font-medium">Overdue</div>}
                        </Td>
                      )}
                      <Td className="whitespace-nowrap text-slate-700">{c.lastOrder ? fmtDate(c.lastOrder, { year: true, weekday: false }) : <span className="text-slate-400">Never</span>}</Td>
                      {showMoney && <Td className="whitespace-nowrap text-right tabular text-slate-700">{c.revenue ? money(c.revenue, { cents: false }) : "—"}</Td>}
                    </RowLink>
                  ))}
                </tbody>
              </Table>
            </div>

            {/* Phone list */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {rows.map((c) => (
                <li key={c.id}>
                  <Link href={`/customers/${c.id}`} className={cn("block px-4 py-3 active:bg-slate-50", c.archived && "opacity-60")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-medium text-slate-900">{c.name}</p>
                        <p className="truncate text-sm text-slate-500">{[c.city, c.phone].filter(Boolean).join(" · ") || "No phone or city"}</p>
                      </div>
                      {showMoney && c.balance ? (
                        <span className={cn("shrink-0 text-sm font-semibold tabular", c.overdue ? "text-red-700" : "text-slate-800")}>{money(c.balance)}</span>
                      ) : null}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-slate-600">
                      {c.openJobs > 0 && <Badge tone="blue">{plural(c.openJobs, "open job")}</Badge>}
                      {c.overdue && <Badge tone="red">Overdue</Badge>}
                      {c.taxExempt && <Badge tone="teal">Tax exempt</Badge>}
                      {c.archived && <Badge>Archived</Badge>}
                      <span className="text-slate-500">Last order: {c.lastOrder ? fmtDate(c.lastOrder, { year: true, weekday: false }) : "never"}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} params={params} />
          </>
        )}
      </Card>
    </>
  );
}
