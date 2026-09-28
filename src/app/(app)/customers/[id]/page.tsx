import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, Briefcase, ChevronLeft, FileText, Globe, Mail, MapPin, Pencil, Phone, Plus } from "lucide-react";
import { getCurrentUser, requirePagePermission, userCan } from "@/lib/auth";
import {
  getContacts,
  getCustomer,
  getCustomerActivity,
  getCustomerCounts,
  getCustomerJobs,
  getCustomerQuotes,
  getCustomerStats,
  type CustomerJobSort,
} from "@/lib/customers/queries";
import { TERMS_LABELS } from "@/lib/money/service";
import { fmtDate, money, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { ArchiveCustomerButton } from "../_components/archive-button";
import { ContactsCard } from "../_components/contacts-card";
import { NotesCard } from "../_components/notes-card";
import { ActivityCard, FilesTab, InvoicesTab, JobList, JobsTable, MessagesTab, PastOrders, QuoteList, QuotesTable } from "./sections";
import { QuickBooksStatus } from "@/components/accounting/quickbooks-status";

type Tab = "overview" | "jobs" | "quotes" | "invoices" | "files" | "messages";
const JOB_SORTS: CustomerJobSort[] = ["number", "title", "status", "due", "created", "total"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  const c = user ? await getCustomer(user.tenantId, Number(id)) : null;
  return { title: c?.name ?? "Customer" };
}

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePagePermission("customers.view");
  const id = Number((await params).id);
  const customer = await getCustomer(user.tenantId, id);
  if (!customer) notFound();
  const sp = await searchParams;

  const can = {
    money: userCan(user, "financials.view"),
    cost: userCan(user, "margins.view"),
    invoices: userCan(user, "money.view"),
    edit: userCan(user, "customers.edit"),
    quotes: userCan(user, "quotes.view"),
    newQuote: userCan(user, "quotes.edit"),
    jobs: userCan(user, "jobs.view"),
    newJob: userCan(user, "jobs.create"),
    upload: userCan(user, "files.upload"),
  };

  const tabs: { key: Tab; label: string; allowed: boolean; count?: number }[] = [
    { key: "overview", label: "Overview", allowed: true },
    { key: "jobs", label: "Jobs", allowed: can.jobs },
    { key: "quotes", label: "Quotes", allowed: can.quotes },
    { key: "invoices", label: "Invoices", allowed: can.invoices },
    { key: "files", label: "Files", allowed: true },
    { key: "messages", label: "Calls & messages", allowed: true },
  ];
  const tabRaw = one(sp.tab) as Tab | undefined;
  const tab: Tab = tabs.some((t) => t.key === tabRaw && t.allowed) ? tabRaw! : "overview";

  const [stats, counts] = await Promise.all([getCustomerStats(user.tenantId, id, can.money), getCustomerCounts(user.tenantId, id, { showMoney: can.invoices })]);
  const countFor: Partial<Record<Tab, number>> = { jobs: counts.jobs, quotes: counts.quotes, invoices: counts.invoices, files: counts.files, messages: counts.comms };

  const base = `/customers/${id}`;
  const archived = customer.archivedAt != null;
  const address = [customer.address, [customer.city, [customer.state, customer.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(", ");
  const mapsHref = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
  const website = customer.website ? (/^https?:\/\//i.test(customer.website) ? customer.website : `https://${customer.website}`) : null;
  const discount = Math.round((customer.discountPct ?? 0) * 100);

  return (
    <>
      <Link href="/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ChevronLeft className="size-4" />
        Customers
      </Link>

      {archived && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-[15px] text-slate-700">
          <span className="flex items-center gap-2 font-medium">
            <Archive className="size-4" />
            This customer is archived. They&apos;re hidden from the customer list.
          </span>
          {can.edit && <ArchiveCustomerButton id={id} name={customer.name} archived />}
        </div>
      )}

      {/* WHO ARE THEY? */}
      <Card className="mb-5 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2.5">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{customer.name}</h1>
              {!customer.isCompany && <p className="text-sm text-slate-500">Individual customer</p>}
            </div>
            <div className="flex flex-col gap-1.5 text-[15px] sm:flex-row sm:flex-wrap sm:gap-x-5">
              {customer.phone && (
                <a href={`tel:${customer.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-2 font-medium text-slate-800 hover:text-brand-700">
                  <Phone className="size-4 text-slate-400" />
                  {customer.phone}
                </a>
              )}
              {customer.email && (
                <a href={`mailto:${customer.email}`} className="inline-flex min-w-0 items-center gap-2 break-all text-slate-800 hover:text-brand-700">
                  <Mail className="size-4 shrink-0 text-slate-400" />
                  {customer.email}
                </a>
              )}
              {website && (
                <a href={website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-slate-800 hover:text-brand-700">
                  <Globe className="size-4 text-slate-400" />
                  {customer.website!.replace(/^https?:\/\//i, "")}
                </a>
              )}
              {address && (
                <a href={mapsHref!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-slate-800 hover:text-brand-700">
                  <MapPin className="size-4 shrink-0 text-slate-400" />
                  {address}
                </a>
              )}
              {!customer.phone && !customer.email && !address && <span className="text-slate-500">No phone, email or address on file.</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {can.money && <Badge tone="gray">{TERMS_LABELS[customer.paymentTerms]}</Badge>}
              {customer.taxExempt && <Badge tone="teal">Tax exempt{customer.taxExemptId ? ` · ${customer.taxExemptId}` : ""}</Badge>}
              {customer.poRequired && <Badge tone="amber">PO required</Badge>}
              {can.money && discount > 0 && <Badge tone="violet">{discount}% customer discount</Badge>}
              {can.money && <QuickBooksStatus tenantId={user.tenantId} entityType="customer" entityId={customer.id} />}
            </div>
            <p className="text-sm text-slate-500">
              {customer.salesperson ? (
                <>
                  Salesperson: <span className="font-medium text-slate-700">{customer.salesperson.name}</span>
                </>
              ) : (
                "No salesperson assigned"
              )}
              {customer.customerSince && <> · Customer since {fmtDate(customer.customerSince, { year: true, weekday: false })}</>}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {can.newQuote && !archived && (
              <LinkButton href={`/quotes/new?customerId=${id}`} variant="primary">
                <FileText className="size-4" />
                New quote
              </LinkButton>
            )}
            {can.newJob && !archived && (
              <LinkButton href={`/jobs/new?customerId=${id}`} variant={can.newQuote ? "secondary" : "primary"}>
                <Briefcase className="size-4" />
                New job
              </LinkButton>
            )}
            {can.edit && (
              <LinkButton href={`${base}/edit`}>
                <Pencil className="size-4" />
                Edit
              </LinkButton>
            )}
            {can.edit && !archived && <ArchiveCustomerButton id={id} name={customer.name} archived={false} />}
          </div>
        </div>
      </Card>

      {/* Quick numbers */}
      <div className={cn("mb-6 grid grid-cols-2 gap-3", stats.money ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        {stats.money && (
          <Stat label="Lifetime revenue" value={money(stats.money.revenue, { cents: false })} sub={stats.totalJobs ? plural(stats.totalJobs, "job") : "No jobs yet"} />
        )}
        {stats.money && (
          <Stat
            label="Outstanding balance"
            value={stats.money.balance ? money(stats.money.balance) : "$0"}
            tone={stats.money.overdue > 0 ? "red" : undefined}
            sub={
              stats.money.overdue > 0
                ? `${money(stats.money.overdue)} overdue`
                : stats.money.balance
                  ? `${plural(stats.money.openInvoices, "open invoice")}, none overdue`
                  : "Nothing owed"
            }
            href={can.invoices ? `${base}?tab=invoices` : undefined}
          />
        )}
        <Stat label="Open jobs" value={String(stats.openJobs)} sub={stats.openJobs ? "In progress now" : "Nothing in progress"} href={can.jobs ? `${base}?tab=jobs` : undefined} />
        <Stat
          label="Last order"
          value={stats.lastOrder ? fmtDate(stats.lastOrder, { weekday: false, year: true }) : "Never"}
        />
        {!stats.money && <Stat label="Jobs all-time" value={String(stats.totalJobs)} sub={stats.totalJobs ? "Not counting cancelled" : "No jobs yet"} />}
      </div>

      <LinkTabs
        active={tab}
        tabs={tabs
          .filter((t) => t.allowed)
          .map((t) => ({ key: t.key, label: t.label, href: t.key === "overview" ? base : `${base}?tab=${t.key}`, count: countFor[t.key] }))}
      />

      {tab === "overview" && <Overview tenantId={user.tenantId} id={id} can={can} notes={customer.notes} billingAddress={customer.billingAddress} archived={archived} />}
      {tab === "jobs" && (
        <JobsTable
          tenantId={user.tenantId}
          customerId={id}
          showMoney={can.money}
          canCreate={can.newJob && !archived}
          canReorder={can.newJob && !archived}
          sort={JOB_SORTS.includes(one(sp.sort) as CustomerJobSort) ? (one(sp.sort) as CustomerJobSort) : undefined}
          dir={one(sp.dir) === "asc" ? "asc" : "desc"}
        />
      )}
      {tab === "quotes" && <QuotesTable tenantId={user.tenantId} customerId={id} showMoney={can.money} canCreate={can.newQuote && !archived} />}
      {tab === "invoices" && <InvoicesTab tenantId={user.tenantId} customerId={id} />}
      {tab === "files" && <FilesTab tenantId={user.tenantId} customerId={id} canUpload={can.upload} />}
      {tab === "messages" && <MessagesTab tenantId={user.tenantId} customerId={id} canLog={can.edit} showMoney={can.invoices} showPrices={can.money} />}
    </>
  );
}

function Stat({ label, value, sub, tone, href }: { label: string; value: string; sub?: string; tone?: "red"; href?: string }) {
  const body = (
    <>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular tracking-tight", tone === "red" ? "text-red-700" : "text-slate-900")}>{value}</p>
      {sub && <p className={cn("mt-0.5 text-sm", tone === "red" ? "font-medium text-red-700" : "text-slate-500")}>{sub}</p>}
    </>
  );
  const cls = cn("block rounded-xl border bg-white px-4 py-3.5 shadow-sm", tone === "red" ? "border-red-200 bg-red-50/40" : "border-slate-200");
  return href ? (
    <Link href={href} className={cn(cls, "hover:border-slate-300")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

async function Overview({
  tenantId,
  id,
  can,
  notes,
  billingAddress,
  archived,
}: {
  tenantId: number;
  id: number;
  can: { money: boolean; cost: boolean; edit: boolean; quotes: boolean; newQuote: boolean; jobs: boolean; newJob: boolean };
  notes: string | null;
  billingAddress: string | null;
  archived: boolean;
}) {
  const [openJobs, pastJobs, openQuotes, contacts, activity] = await Promise.all([
    can.jobs ? getCustomerJobs(tenantId, id, { showMoney: can.money, openOnly: true }) : Promise.resolve([]),
    can.jobs ? getCustomerJobs(tenantId, id, { showMoney: can.money, sort: "created", dir: "desc" }) : Promise.resolve([]),
    can.quotes ? getCustomerQuotes(tenantId, id, { showMoney: can.money, openOnly: true }) : Promise.resolve([]),
    getContacts(tenantId, id),
    getCustomerActivity(tenantId, id, { showMoney: can.money, showCost: can.cost, limit: 8 }),
  ]);
  const completed = pastJobs.filter((j) => j.status === "completed").slice(0, 5);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {can.jobs && (
          <JobList
            title="What we're doing for them"
            jobs={openJobs}
            showMoney={can.money}
            empty="No open jobs for this customer"
            action={
              can.newJob && !archived ? (
                <LinkButton href={`/jobs/new?customerId=${id}`} size="sm" variant="ghost">
                  <Plus className="size-3.5" />
                  New job
                </LinkButton>
              ) : undefined
            }
          />
        )}
        {can.quotes && (
          <QuoteList
            quotes={openQuotes}
            showMoney={can.money}
            action={
              can.newQuote && !archived ? (
                <LinkButton href={`/quotes/new?customerId=${id}`} size="sm" variant="ghost">
                  <Plus className="size-3.5" />
                  New quote
                </LinkButton>
              ) : undefined
            }
          />
        )}
        {can.jobs && <PastOrders customerId={id} canReorder={can.newJob && !archived} jobs={completed} total={pastJobs.filter((j) => j.status === "completed").length} showMoney={can.money} />}
        <ActivityCard activity={activity} />
      </div>
      <div className="space-y-5">
        <ContactsCard customerId={id} contacts={contacts} canEdit={can.edit} />
        <NotesCard customerId={id} notes={notes} canEdit={can.edit} />
        {billingAddress && (
          <Card className="px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">Billing address</h2>
            <p className="mt-1.5 whitespace-pre-wrap text-[15px] text-slate-700">{billingAddress}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
