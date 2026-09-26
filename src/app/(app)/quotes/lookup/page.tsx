import Link from "next/link";
import { History } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { findSimilarJobs, parseLookup } from "@/lib/pricing/history";
import { getCategories } from "@/lib/lookups";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, Th, Tr, Td } from "@/components/ui/table";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { fmtDate, fmtSize, jobNo, money } from "@/lib/format";

export const metadata = { title: "Price Lookup" };

export default async function LookupPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const user = await requirePagePermission("quotes.view");
  const { q = "", category } = await searchParams;
  const cats = await getCategories(user.tenantId);
  const parsed = parseLookup(q);
  // Match a category by name if the text mentions one ("banner", "business cards", "wrap")
  const words = parsed.text.toLowerCase();
  const byText = cats.find((c) => words && (words.includes(c.name.toLowerCase().replace(/s$/, "")) || words.includes(c.slug.replace(/-/g, " ").replace(/s$/, ""))));
  const categoryId = category ? Number(category) : (byText?.id ?? null);
  const showMoney = can(user.role, "financials.view");
  const result = q || category ? await findSimilarJobs(user.tenantId, { ...parsed, categoryId, text: parsed.text || null, limit: 50 }) : null;

  return (
    <>
      <PageHeader title="Price lookup" back={{ href: "/quotes", label: "Quotes" }} subtitle="“What did we charge last time?” Try “4x8 banner”, “500 business cards” or “Ford Transit wrap”." />
      <Card className="mb-5">
        <CardBody>
          <form className="flex flex-col gap-3 md:flex-row">
            <input
              name="q"
              defaultValue={q}
              autoFocus
              placeholder="Show me every 4x8 banner we have sold…"
              className="h-12 flex-1 rounded-lg border border-slate-300 px-4 text-base shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <AutoSubmitSelect name="category" value={category} label="Category" options={cats.map((c) => ({ value: String(c.id), label: c.name }))} className="h-12 rounded-lg" />
            <button className="h-12 rounded-lg bg-brand-500 px-6 font-semibold text-white hover:bg-brand-600">Search</button>
          </form>
          {q && (
            <p className="mt-2 text-sm text-slate-500">
              Looking for {[parsed.quantity && `qty ≈ ${parsed.quantity.toLocaleString()}`, parsed.widthIn && `size ≈ ${fmtSize(parsed.widthIn, parsed.heightIn)}`, categoryId && cats.find((c) => c.id === categoryId)?.name, parsed.text && `“${parsed.text}”`].filter(Boolean).join(" · ") || "anything"}
            </p>
          )}
        </CardBody>
      </Card>

      {result && (
        <>
          {result.stats && showMoney && (
            <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="Close matches" value={String(result.stats.count)} />
              <Stat label="Average price" value={money(result.stats.avgCents)} />
              <Stat label="Lowest" value={money(result.stats.minCents)} />
              <Stat label="Highest" value={money(result.stats.maxCents)} />
            </div>
          )}
          <Card>
            {result.jobs.length === 0 ? (
              <EmptyState icon={History} title="No past jobs match." description="Try fewer words or a different size." />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Job</Th>
                    <Th>What</Th>
                    <Th>Customer</Th>
                    <Th>Date</Th>
                    {showMoney && <Th className="text-right">Price</Th>}
                  </tr>
                </THead>
                <tbody>
                  {result.jobs.map((j) => (
                    <Tr key={`${j.jobId}-${j.description}`} className={j.close ? "" : "text-slate-500"}>
                      <Td className="whitespace-nowrap">
                        <Link href={`/jobs/${j.number}`} className="font-medium text-brand-700 hover:underline">
                          {jobNo(j.number)}
                        </Link>
                      </Td>
                      <Td className="min-w-64">
                        <p className="font-medium text-slate-900">{j.title}</p>
                        <p className="text-sm text-slate-500">{[j.quantity > 1 && `${j.quantity.toLocaleString()} pcs`, fmtSize(j.widthIn, j.heightIn), j.material].filter(Boolean).join(" · ")}</p>
                      </Td>
                      <Td>{j.customer}</Td>
                      <Td className="whitespace-nowrap text-sm">{fmtDate(j.date, { year: true, weekday: false })}</Td>
                      {showMoney && <Td className="tabular text-right font-semibold">{money(j.priceCents)}</Td>}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className="tabular mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      </CardBody>
    </Card>
  );
}
