import Link from "next/link";
import { Briefcase, Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listJobs, jobViewCounts, JOB_VIEWS } from "@/lib/jobs/queries";
import { getActiveUsers, getLocations } from "@/lib/lookups";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, Th, Tr, Td, SortTh, Pagination } from "@/components/ui/table";
import { JobStatusBadge, PriorityBadge } from "@/components/status";
import { Chips, withParams } from "@/components/chips";
import { SearchInput } from "@/components/search-input";
import { DueText, LocationTag, OwnerTag } from "@/components/jobs/job-meta";
import { ViewToggle } from "@/components/jobs/view-toggle";
import { jobNo, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AutoSubmitSelect } from "@/components/auto-submit-select";

export const metadata = { title: "Jobs" };

/** Views reached from dashboard alerts; shown as a chip only while active. */
const EXTRA_VIEWS: Record<string, string> = { noart: "Missing artwork", proofs: "Proof approval" };

type SP = { q?: string; view?: string; location?: string; assignee?: string; sort?: string; dir?: string; page?: string };

export default async function JobsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePagePermission("jobs.view");
  const sp = await searchParams;
  const view = sp.view ?? "open";
  const [{ rows, total, page, pageSize }, counts, people, locations] = await Promise.all([
    listJobs({ ...sp, view, assignee: sp.assignee ? Number(sp.assignee) : undefined, page: Number(sp.page) || 1 }, user),
    jobViewCounts(user),
    getActiveUsers(),
    getLocations(),
  ]);
  const showMoney = can(user.role, "financials.view");
  const params = { q: sp.q, view: sp.view, location: sp.location, assignee: sp.assignee, sort: sp.sort, dir: sp.dir };
  const countFor = (k: string) => (counts as Record<string, number>)[k];

  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle={`${counts.open} open jobs${counts.overdue ? ` · ${counts.overdue} overdue` : ""}`}
        actions={
          <>
            <ViewToggle active="list" />
            {can(user.role, "jobs.create") && (
              <LinkButton href="/jobs/new" variant="primary">
                <Plus className="size-4" /> New job
              </LinkButton>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <SearchInput placeholder="Search job #, title, customer, PO, material…" className="md:w-96" />
          <div className="flex flex-wrap gap-2">
            <FilterSelect label="Location" name="location" value={sp.location} params={params} options={locations.map((l) => ({ value: l.code, label: l.name }))} />
            <FilterSelect label="Person" name="assignee" value={sp.assignee} params={params} options={people.map((p) => ({ value: String(p.id), label: p.name }))} />
          </div>
        </div>
        <Chips
          active={view}
          items={[...JOB_VIEWS, ...(EXTRA_VIEWS[view] ? [{ key: view, label: EXTRA_VIEWS[view]! }] : [])].map((v) => ({
            key: v.key,
            label: v.label,
            count: countFor(v.key),
            tone: v.key === "overdue" ? "red" : "default",
            href: withParams("/jobs", params, { view: v.key === "open" ? undefined : v.key, page: undefined }),
          }))}
        />
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title={sp.q ? `No jobs match “${sp.q}”` : view === "overdue" ? "Nothing is overdue. Nice work." : view === "today" ? "No jobs are due today." : view === "proofs" ? "No jobs are waiting for proof approval." : view === "noart" ? "Every production job has artwork on file." : "No jobs here."}
            description={sp.q ? "Try a customer name, job number or product." : undefined}
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <SortTh label="Job" field="number" sort={sp.sort} dir={sp.dir} params={params} />
                  <Th>Title / Customer</Th>
                  <SortTh label="Status" field="status" sort={sp.sort} dir={sp.dir} params={params} />
                  <SortTh label="Due" field="due" sort={sp.sort} dir={sp.dir} params={params} />
                  <Th className="hidden md:table-cell">Who has it</Th>
                  <Th className="hidden lg:table-cell">Location</Th>
                  {showMoney && <SortTh label="Total" field="total" sort={sp.sort} dir={sp.dir} params={params} className="text-right" />}
                </tr>
              </THead>
              <tbody>
                {rows.map((j) => (
                  <Tr key={j.id} className={cn("hover:bg-slate-50", j.overdue && "bg-red-50/40")}>
                    <Td className="whitespace-nowrap font-medium">
                      <Link href={`/jobs/${j.number}`} className="text-brand-700 hover:underline">
                        {jobNo(j.number)}
                      </Link>
                    </Td>
                    <Td className="min-w-64">
                      <Link href={`/jobs/${j.number}`} className="block font-medium text-slate-900 hover:underline">
                        {j.title}
                      </Link>
                      <span className="text-sm text-slate-500">{j.customer}</span>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <JobStatusBadge status={j.status} />
                        <PriorityBadge priority={j.priority} />
                      </div>
                    </Td>
                    <Td className="text-sm">
                      {j.status === "completed" ? <span className="text-slate-500">Done</span> : <DueText dueDate={j.dueDate} overdue={j.overdue} />}
                    </Td>
                    <Td className="hidden md:table-cell">
                      <OwnerTag name={j.owner} color={j.ownerColor} />
                    </Td>
                    <Td className="hidden lg:table-cell">
                      <LocationTag code={j.locationCode} name={j.locationName} />
                    </Td>
                    {showMoney && <Td className="tabular text-right">{money(j.totalCents)}</Td>}
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={pageSize} total={total} params={params} />
          </>
        )}
      </Card>
    </>
  );
}

function FilterSelect({ label, name, value, params, options }: { label: string; name: string; value?: string; params: Record<string, string | undefined>; options: { value: string; label: string }[] }) {
  return (
    <form action="/jobs" className="flex items-center">
      {Object.entries(params)
        .filter(([k, v]) => k !== name && v)
        .map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      <AutoSubmitSelect name={name} value={value} label={label} options={options} />
    </form>
  );
}

