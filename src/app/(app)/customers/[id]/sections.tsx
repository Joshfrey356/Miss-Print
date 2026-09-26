import Link from "next/link";
import { Briefcase, FileText, FolderOpen, History, Mail, MessageSquare, NotebookPen, PhoneIncoming, PhoneOutgoing, Plus, Receipt, RotateCcw } from "lucide-react";
import {
  getCustomerCommunications,
  getCustomerFiles,
  getCustomerInvoices,
  getCustomerJobs,
  getCustomerQuotes,
  type CustomerJobSort,
} from "@/lib/customers/queries";
import { FOLDER_LABELS } from "@/lib/files";
import { balanceOf, isInvoiceOverdue } from "@/lib/money/service";
import { dueLabel, fmtDate, fmtDateTime, invoiceNo, jobNo, money, quoteNo, timeAgo, today, ymdOf } from "@/lib/format";
import type { FileFolder, JobStatus, Priority, QuoteStatus } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SortTh, Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { InvoiceStatusBadge, JobStatusBadge, PriorityBadge, QuoteStatusBadge } from "@/components/status";
import { FileUploader } from "@/components/file-uploader";
import { CommForm } from "../_components/comm-form";

type JobRow = {
  id: number;
  number: number;
  title: string;
  status: JobStatus;
  priority: Priority;
  dueDate: string | null;
  createdAt: Date;
  completedAt: Date | null;
  totalCents: number | null;
};
type QuoteRow = {
  id: number;
  number: number;
  title: string;
  status: QuoteStatus;
  totalCents: number | null;
  validUntil: string | null;
  createdAt: Date;
};

function DueText({ due, status }: { due: string | null; status: JobStatus }) {
  const late = due != null && due < today() && status !== "completed" && status !== "cancelled";
  const soon = due != null && (due === today() || due === today(1));
  return <span className={cn("whitespace-nowrap", late ? "font-semibold text-red-700" : soon ? "font-medium text-amber-700" : "text-slate-600")}>{dueLabel(due)}</span>;
}

// ---------------------------------------------------------------------------
// Overview cards
// ---------------------------------------------------------------------------
export function JobList({
  title,
  jobs,
  showMoney,
  empty,
  action,
}: {
  title: string;
  jobs: JobRow[];
  showMoney: boolean;
  empty: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} action={action} />
      {jobs.length === 0 ? (
        <EmptyState icon={Briefcase} title={empty} compact />
      ) : (
        <ul className="divide-y divide-slate-100">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link href={`/jobs/${j.number}`} className="flex flex-col gap-1.5 px-5 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-slate-900">
                    <span className="text-slate-500">{jobNo(j.number)}</span> · {j.title}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <JobStatusBadge status={j.status} short />
                    <PriorityBadge priority={j.priority} />
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm sm:flex-col sm:items-end sm:gap-0.5">
                  <span className="text-slate-500">
                    Due <DueText due={j.dueDate} status={j.status} />
                  </span>
                  {showMoney && j.totalCents != null && <span className="tabular text-slate-700">{money(j.totalCents)}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function QuoteList({ quotes, showMoney, action }: { quotes: QuoteRow[]; showMoney: boolean; action?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title="Open quotes" action={action} />
      {quotes.length === 0 ? (
        <EmptyState icon={FileText} title="No open quotes for this customer" compact />
      ) : (
        <ul className="divide-y divide-slate-100">
          {quotes.map((q) => (
            <li key={q.id}>
              <Link href={`/quotes/${q.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-slate-900">
                    <span className="text-slate-500">{quoteNo(q.number)}</span> · {q.title}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                    <QuoteStatusBadge status={q.status} />
                    {q.validUntil && <span>Good until {fmtDate(q.validUntil, { weekday: false })}</span>}
                  </div>
                </div>
                {showMoney && q.totalCents != null && <span className="shrink-0 tabular text-[15px] text-slate-700">{money(q.totalCents)}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function PastOrders({
  customerId,
  jobs,
  total,
  showMoney,
  canReorder,
}: {
  customerId: number;
  jobs: JobRow[];
  total: number;
  showMoney: boolean;
  canReorder: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title="What they've ordered before"
        action={
          total > jobs.length ? (
            <Link href={`/customers/${customerId}?tab=jobs`} className="text-sm font-medium text-brand-700 hover:underline">
              See all {total}
            </Link>
          ) : undefined
        }
      />
      {jobs.length === 0 ? (
        <EmptyState icon={History} title="No completed orders yet" compact />
      ) : (
        <ul className="divide-y divide-slate-100">
          {jobs.map((j) => (
            <li key={j.id} className="flex items-center gap-3 px-5 py-3">
              <Link href={`/jobs/${j.number}`} className="min-w-0 flex-1 hover:text-brand-700">
                <p className="truncate text-[15px] font-medium text-slate-900">
                  <span className="text-slate-500">{jobNo(j.number)}</span> · {j.title}
                </p>
                <p className="text-sm text-slate-500">
                  Completed {fmtDate(ymdOf(j.completedAt ?? j.createdAt), { year: true, weekday: false })}
                  {showMoney && j.totalCents != null && <> · {money(j.totalCents)}</>}
                </p>
              </Link>
              {canReorder && <ReorderLink number={j.number} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReorderLink({ number }: { number: number }) {
  return (
    <LinkButton href={`/jobs/${number}?reorder=1`} size="sm" className="shrink-0">
      <RotateCcw className="size-3.5" />
      Reorder
    </LinkButton>
  );
}

export function ActivityCard({
  activity,
}: {
  activity: { id: number; summary: string; createdAt: Date; actor: string | null; actorColor: string | null; jobNumber: number | null; jobTitle: string | null }[];
}) {
  return (
    <Card>
      <CardHeader title="Recent activity" />
      {activity.length === 0 ? (
        <p className="px-5 py-4 text-[15px] text-slate-500">Nothing has happened with this customer yet.</p>
      ) : (
        <ul className="space-y-3 px-5 py-4">
          {activity.map((a) => (
            <li key={a.id} className="flex items-start gap-3">
              <Avatar name={a.actor ?? "System"} color={a.actor ? a.actorColor : "#94a3b8"} size="sm" className="mt-0.5" />
              <div className="min-w-0">
                <p className="text-[15px] text-slate-800">
                  {a.summary}
                  {a.jobNumber && (
                    <>
                      {" · "}
                      <Link href={`/jobs/${a.jobNumber}`} className="text-brand-700 hover:underline">
                        {jobNo(a.jobNumber)} {a.jobTitle}
                      </Link>
                    </>
                  )}
                </p>
                <p className="text-xs text-slate-500" title={fmtDateTime(a.createdAt)}>
                  {a.actor ? `${a.actor} · ` : ""}
                  {timeAgo(a.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
export async function JobsTable({
  customerId,
  showMoney,
  canCreate,
  canReorder,
  sort,
  dir,
}: {
  customerId: number;
  showMoney: boolean;
  canCreate: boolean;
  canReorder: boolean;
  sort?: CustomerJobSort;
  dir: "asc" | "desc";
}) {
  const jobs = await getCustomerJobs(customerId, { showMoney, sort: sort ?? "created", dir: sort ? dir : "desc" });
  const params = { tab: "jobs" };
  const s = sort ?? "created";
  const d = sort ? dir : "desc";
  return (
    <Card>
      {jobs.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No jobs for this customer yet"
          action={
            canCreate && (
              <LinkButton href={`/jobs/new?customerId=${customerId}`} variant="primary">
                <Plus className="size-4" />
                New job
              </LinkButton>
            )
          }
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <SortTh label="Job #" field="number" sort={s} dir={d} params={params} />
              <SortTh label="What" field="title" sort={s} dir={d} params={params} />
              <SortTh label="Status" field="status" sort={s} dir={d} params={params} />
              <SortTh label="Due" field="due" sort={s} dir={d} params={params} />
              <SortTh label="Ordered" field="created" sort={s} dir={d} params={params} />
              {showMoney && <SortTh label="Total" field="total" sort={s} dir={d} params={params} className="text-right" />}
              <Th>
                <span className="sr-only">Reorder</span>
              </Th>
            </tr>
          </THead>
          <tbody>
            {jobs.map((j) => (
              <Tr key={j.id} className="hover:bg-slate-50">
                <Td className="whitespace-nowrap">
                  <Link href={`/jobs/${j.number}`} className="font-medium text-brand-700 hover:underline">
                    {jobNo(j.number)}
                  </Link>
                </Td>
                <Td className="min-w-48">
                  <Link href={`/jobs/${j.number}`} className="text-slate-900 hover:text-brand-700">
                    {j.title}
                  </Link>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <JobStatusBadge status={j.status} short />
                    <PriorityBadge priority={j.priority} />
                  </div>
                </Td>
                <Td>{j.status === "completed" || j.status === "cancelled" ? <span className="text-slate-500">{fmtDate(j.dueDate, { weekday: false, year: true })}</span> : <DueText due={j.dueDate} status={j.status} />}</Td>
                <Td className="whitespace-nowrap text-slate-600">{fmtDate(ymdOf(j.createdAt), { weekday: false, year: true })}</Td>
                {showMoney && <Td className="whitespace-nowrap text-right tabular">{money(j.totalCents)}</Td>}
                <Td className="text-right">{canReorder && j.status === "completed" && <ReorderLink number={j.number} />}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export async function QuotesTable({ customerId, showMoney, canCreate }: { customerId: number; showMoney: boolean; canCreate: boolean }) {
  const quotes = await getCustomerQuotes(customerId, { showMoney });
  return (
    <Card>
      {quotes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No quotes for this customer yet"
          action={
            canCreate && (
              <LinkButton href={`/quotes/new?customerId=${customerId}`} variant="primary">
                <Plus className="size-4" />
                New quote
              </LinkButton>
            )
          }
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Quote #</Th>
              <Th>What</Th>
              <Th>Status</Th>
              <Th>Created</Th>
              <Th>Good until</Th>
              {showMoney && <Th className="text-right">Total</Th>}
            </tr>
          </THead>
          <tbody>
            {quotes.map((q) => (
              <Tr key={q.id} className="hover:bg-slate-50">
                <Td className="whitespace-nowrap">
                  <Link href={`/quotes/${q.id}`} className="font-medium text-brand-700 hover:underline">
                    {quoteNo(q.number)}
                  </Link>
                </Td>
                <Td className="min-w-48">
                  <Link href={`/quotes/${q.id}`} className="text-slate-900 hover:text-brand-700">
                    {q.title}
                  </Link>
                </Td>
                <Td>
                  <QuoteStatusBadge status={q.status} />
                </Td>
                <Td className="whitespace-nowrap text-slate-600">{fmtDate(ymdOf(q.createdAt), { weekday: false, year: true })}</Td>
                <Td className="whitespace-nowrap text-slate-600">{fmtDate(q.validUntil, { weekday: false, year: true })}</Td>
                {showMoney && <Td className="whitespace-nowrap text-right tabular">{money(q.totalCents)}</Td>}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export async function InvoicesTab({ customerId }: { customerId: number }) {
  const invoices = await getCustomerInvoices(customerId);
  const now = today();
  return (
    <Card>
      {invoices.length === 0 ? (
        <EmptyState icon={Receipt} title="No invoices for this customer yet" />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Invoice #</Th>
              <Th>Job</Th>
              <Th>Status</Th>
              <Th>Issued</Th>
              <Th>Due</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Balance</Th>
            </tr>
          </THead>
          <tbody>
            {invoices.map((inv) => {
              const overdue = isInvoiceOverdue(inv, now);
              const bal = balanceOf(inv);
              return (
                <Tr key={inv.id} className={cn("hover:bg-slate-50", inv.status === "void" && "text-slate-400")}>
                  <Td className="whitespace-nowrap">
                    <Link href={`/money/invoices/${inv.id}`} className="font-medium text-brand-700 hover:underline">
                      {invoiceNo(inv.number)}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {inv.jobNumber ? (
                      <Link href={`/jobs/${inv.jobNumber}`} className="text-slate-700 hover:text-brand-700">
                        {jobNo(inv.jobNumber)}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </Td>
                  <Td>
                    <InvoiceStatusBadge status={inv.status} overdue={overdue} />
                  </Td>
                  <Td className="whitespace-nowrap text-slate-600">{fmtDate(inv.issueDate, { weekday: false, year: true })}</Td>
                  <Td className={cn("whitespace-nowrap", overdue ? "font-medium text-red-700" : "text-slate-600")}>{fmtDate(inv.dueDate, { weekday: false, year: true })}</Td>
                  <Td className="whitespace-nowrap text-right tabular">{money(inv.totalCents)}</Td>
                  <Td className={cn("whitespace-nowrap text-right tabular", bal > 0 ? (overdue ? "font-semibold text-red-700" : "font-medium text-slate-900") : "text-slate-400")}>
                    {bal > 0 && inv.status !== "draft" ? money(bal) : "—"}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

const fmtSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);

export async function FilesTab({ customerId, canUpload }: { customerId: number; canUpload: boolean }) {
  const files = await getCustomerFiles(customerId);
  const groups = new Map<FileFolder, typeof files>();
  for (const f of files) groups.set(f.folder, [...(groups.get(f.folder) ?? []), f]);
  const order = Object.keys(FOLDER_LABELS) as FileFolder[];
  return (
    <div className="space-y-5">
      {canUpload && (
        <FileUploader folder="customer" customerId={customerId} label="Drop customer files here or click to upload" hint="Logos, brand guides, tax forms — anything we'll reuse for this customer." />
      )}
      {files.length === 0 ? (
        <Card>
          <EmptyState icon={FolderOpen} title="No files for this customer yet" description="Files uploaded to their jobs show up here too." />
        </Card>
      ) : (
        order
          .filter((k) => groups.has(k))
          .map((k) => (
            <Card key={k}>
              <CardHeader title={FOLDER_LABELS[k]} description={`${groups.get(k)!.length} file${groups.get(k)!.length === 1 ? "" : "s"}`} />
              <ul className="divide-y divide-slate-100">
                {groups.get(k)!.map((f) => (
                  <li key={f.id} className="flex flex-col gap-0.5 px-5 py-2.5 sm:flex-row sm:items-center sm:gap-4">
                    <a href={`/api/files/${f.id}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-[15px] font-medium text-brand-700 hover:underline">
                      {f.filename}
                    </a>
                    <span className="flex flex-wrap gap-x-3 text-sm text-slate-500">
                      {f.jobNumber && (
                        <Link href={`/jobs/${f.jobNumber}`} className="hover:text-brand-700">
                          {jobNo(f.jobNumber)}
                        </Link>
                      )}
                      <span>{fmtSize(f.sizeBytes)}</span>
                      <span>
                        {f.uploadedBy ? `${f.uploadedBy}, ` : ""}
                        {fmtDate(ymdOf(f.createdAt), { weekday: false, year: true })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))
      )}
    </div>
  );
}

const CHANNEL: Record<string, { label: (dir: string) => string; icon: typeof Mail; tone: string }> = {
  phone: { label: (d) => (d === "inbound" ? "They called us" : "We called them"), icon: PhoneIncoming, tone: "bg-emerald-50 text-emerald-700" },
  note: { label: () => "Note", icon: NotebookPen, tone: "bg-amber-50 text-amber-700" },
  email: { label: (d) => (d === "inbound" ? "Email received" : "Email sent"), icon: Mail, tone: "bg-brand-50 text-brand-700" },
  sms: { label: (d) => (d === "inbound" ? "Text received" : "Text sent"), icon: MessageSquare, tone: "bg-violet-50 text-violet-700" },
};

export async function MessagesTab({ customerId, canLog, showMoney, showPrices }: { customerId: number; canLog: boolean; showMoney: boolean; showPrices: boolean }) {
  const items = await getCustomerCommunications(customerId, { showMoney, showPrices });
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {canLog && (
        <Card className="lg:order-2">
          <CardHeader title="Log a call or note" />
          <CardBody>
            <CommForm customerId={customerId} />
          </CardBody>
        </Card>
      )}
      <Card className={cn("lg:order-1", canLog ? "lg:col-span-2" : "lg:col-span-3")}>
        <CardHeader title="Communication history" description="Calls, notes, emails and texts, newest first." />
        {items.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No calls or messages logged yet" description={canLog ? "Log a phone call or note so the whole team knows what was said." : undefined} compact />
        ) : (
          <ol className="divide-y divide-slate-100">
            {items.map((m) => {
              const ch = CHANNEL[m.channel] ?? CHANNEL.note;
              const Icon = m.channel === "phone" && m.direction === "outbound" ? PhoneOutgoing : ch.icon;
              return (
                <li key={m.id} className="flex gap-3 px-5 py-3.5">
                  <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", ch.tone)}>
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-[15px]">
                      <span className="font-medium text-slate-900">{ch.label(m.direction)}</span>
                      {m.toAddress && m.channel !== "phone" && m.channel !== "note" && <span className="text-sm text-slate-500">to {m.toAddress}</span>}
                      {m.status === "failed" && <span className="text-sm font-medium text-red-700">Failed to send</span>}
                    </p>
                    {m.subject && <p className="text-[15px] font-medium text-slate-800">{m.subject}</p>}
                    {m.body && <p className="mt-0.5 line-clamp-6 whitespace-pre-wrap text-[15px] text-slate-700">{m.body}</p>}
                    <p className="mt-1 text-xs text-slate-500">
                      {m.sentBy ?? "System"} · {fmtDateTime(m.createdAt)}
                      {m.jobNumber && (
                        <>
                          {" · "}
                          <Link href={`/jobs/${m.jobNumber}`} className="hover:text-brand-700">
                            {jobNo(m.jobNumber)}
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
