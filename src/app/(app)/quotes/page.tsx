import Link from "next/link";
import { FileText, Plus, Search } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listQuotes, quoteCounts, QUOTE_VIEWS, FOLLOWUP_DAYS } from "@/lib/quotes/queries";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, Th, Tr, Td, SortTh, Pagination } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";
import { QuoteStatusBadge } from "@/components/status";
import { Chips, withParams } from "@/components/chips";
import { SearchInput } from "@/components/search-input";
import { money, moneyShort, quoteNo, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Quotes" };

type SP = { q?: string; view?: string; sort?: string; dir?: string; page?: string };

export default async function QuotesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePagePermission("quotes.view");
  const sp = await searchParams;
  const view = sp.view ?? "open";
  const [{ rows, total, value, page, pageSize }, counts] = await Promise.all([listQuotes({ ...sp, view, page: Number(sp.page) || 1 }), quoteCounts()]);
  const showMoney = can(user.role, "financials.view");
  const params = { q: sp.q, view: sp.view, sort: sp.sort, dir: sp.dir };

  return (
    <>
      <PageHeader
        title="Quotes"
        subtitle={`${counts.open} open${showMoney && view === "open" ? ` · ${moneyShort(value)} in open quotes` : ""}${counts.followup ? ` · ${counts.followup} need follow-up` : ""}`}
        actions={
          <>
            <LinkButton href="/quotes/lookup">
              <Search className="size-4" /> Price lookup
            </LinkButton>
            {can(user.role, "quotes.edit") && (
              <LinkButton href="/quotes/new" variant="primary">
                <Plus className="size-4" /> New quote
              </LinkButton>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3">
        <SearchInput placeholder="Search Q-number, title or customer…" className="md:w-96" />
        <Chips
          active={view}
          items={QUOTE_VIEWS.map((v) => ({
            key: v.key,
            label: v.label,
            count: (counts as Record<string, number>)[v.key],
            tone: v.key === "followup" ? "red" : "default",
            href: withParams("/quotes", params, { view: v.key === "open" ? undefined : v.key, page: undefined }),
          }))}
        />
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={view === "followup" ? "No quotes need follow-up right now." : view === "accepted" ? "No accepted quotes waiting to become jobs." : sp.q ? `No quotes match “${sp.q}”` : "No quotes here."}
            action={can(user.role, "quotes.edit") && view === "open" ? <LinkButton href="/quotes/new" variant="primary">Create a quote</LinkButton> : undefined}
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <SortTh label="Quote" field="number" sort={sp.sort} dir={sp.dir} params={params} />
                  <Th>Title / Customer</Th>
                  <Th>Status</Th>
                  <Th>Sent</Th>
                  <Th className="hidden md:table-cell">Sales</Th>
                  {showMoney && <SortTh label="Total" field="total" sort={sp.sort} dir={sp.dir} params={params} className="text-right" />}
                </tr>
              </THead>
              <tbody>
                {rows.map((q) => {
                  const days = q.sentAt ? Math.floor((Date.now() - q.sentAt.getTime()) / 86400000) : null;
                  const stale = q.status === "sent" && days != null && days >= FOLLOWUP_DAYS;
                  return (
                    <Tr key={q.id} className="hover:bg-slate-50">
                      <Td className="whitespace-nowrap font-medium">
                        <Link href={`/quotes/${q.id}`} className="text-brand-700 hover:underline">
                          {quoteNo(q.number)}
                        </Link>
                      </Td>
                      <Td className="min-w-64">
                        <Link href={`/quotes/${q.id}`} className="block font-medium text-slate-900 hover:underline">
                          {q.title}
                        </Link>
                        <span className="text-sm text-slate-500">{q.customer}</span>
                      </Td>
                      <Td>
                        <QuoteStatusBadge status={q.status} />
                      </Td>
                      <Td className={cn("whitespace-nowrap text-sm", stale ? "font-semibold text-amber-700" : "text-slate-600")}>
                        {q.sentAt ? (stale ? `${days} days — follow up` : timeAgo(q.sentAt)) : "Not sent"}
                      </Td>
                      <Td className="hidden md:table-cell">{q.salesperson && <Avatar name={q.salesperson} color={q.salesColor} size="sm" />}</Td>
                      {showMoney && <Td className="tabular text-right">{money(q.totalCents)}</Td>}
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={pageSize} total={total} params={params} />
          </>
        )}
      </Card>
    </>
  );
}
