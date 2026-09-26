import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import { AlertTriangle, Building2, CalendarClock, FileText, Mail, MapPin, Phone, RotateCcw, Truck } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { expenses } from "@/lib/db/schema";
import { getJobDetail } from "@/lib/jobs/queries";
import { getJobProfitability } from "@/lib/jobs/profit";
import { getActiveUsers, getCategories, getLocations } from "@/lib/lookups";
import { getJobMessages } from "@/lib/messages/queries";
import { getTasksFor } from "@/lib/tasks/queries";
import { FULFILLMENT_LABELS, WORK_STATUSES } from "@/lib/jobs/workflow";
import { dueLabel, fmtDate, fmtDateTime, jobNo, parseJobNumber, quoteNo, today } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import { JobStatusBadge, PriorityBadge } from "@/components/status";
import { LocationTag } from "@/components/jobs/job-meta";
import { HeaderActions } from "@/components/jobs/detail/header-actions";
import { Assignments } from "@/components/jobs/detail/assignments";
import { EditJobDialog } from "@/components/jobs/detail/edit-job-dialog";
import { ItemsTable } from "@/components/jobs/detail/items-table";
import { FilesPanel } from "@/components/jobs/detail/files-panel";
import { ProofsPanel } from "@/components/jobs/detail/proofs-panel";
import { HistoryPanel } from "@/components/jobs/detail/history-panel";
import { MoneyPanel } from "@/components/jobs/detail/money-panel";
import { JobChat } from "@/components/chat/job-chat";
import { TaskList } from "@/components/tasks/task-list";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return { title: `MP-${parseJobNumber(number) ?? number}` };
}

export default async function JobPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePagePermission("jobs.view");
  const { number: raw } = await params;
  const { tab = "details" } = await searchParams;
  const number = parseJobNumber(raw);
  if (!number) notFound();
  const d = await getJobDetail(number, user);
  if (!d) notFound();
  const { job } = d;

  const r = user.role;
  const canEdit = can(r, "jobs.edit");
  const canStatus = can(r, "jobs.status");
  const canSeeCost = can(r, "margins.view");
  const [people, categories, locations, messages, tasks, profit, jobExpenses] = await Promise.all([
    getActiveUsers(),
    getCategories(),
    getLocations(),
    can(r, "messages.use") ? getJobMessages(job.id) : Promise.resolve([]),
    getTasksFor({ jobId: job.id }),
    canSeeCost ? getJobProfitability(job.id) : Promise.resolve(null),
    canSeeCost
      ? db
          .select({ id: expenses.id, vendorName: expenses.vendorName, amountCents: expenses.amountCents, category: expenses.category, spentOn: expenses.spentOn, receiptFileId: expenses.receiptFileId })
          .from(expenses)
          .where(and(eq(expenses.jobId, job.id), isNull(expenses.archivedAt)))
          .orderBy(desc(expenses.spentOn))
      : Promise.resolve([]),
  ]);

  const t = today();
  const overdue = !!job.dueDate && job.dueDate < t && WORK_STATUSES.includes(job.status);
  const proofFiles = d.files.filter((f) => f.folder !== "proof");
  const openTasks = tasks.filter((x) => !x.completedAt).length;
  const hasArtwork = d.files.some((f) => ["original_artwork", "customer", "production"].includes(f.folder));
  const showMoneyTab = d.canSeeMoney || can(r, "money.view");
  const base = `/jobs/${job.number}`;
  const tabs = [
    { key: "details", label: "Details", href: base },
    { key: "files", label: "Files & Proofs", href: `${base}?tab=files`, count: d.files.length },
    ...(can(r, "messages.use") ? [{ key: "chat", label: "Chat", href: `${base}?tab=chat`, count: messages.length }] : []),
    { key: "tasks", label: "Tasks", href: `${base}?tab=tasks`, count: openTasks },
    ...(showMoneyTab ? [{ key: "money", label: "Money", href: `${base}?tab=money` }] : []),
    { key: "history", label: "History", href: `${base}?tab=history` },
  ];
  const first = d.items[0];
  const chatUsers = people.map((p) => ({ id: p.id, name: p.name, handle: p.handle, color: p.color, role: p.role }));

  return (
    <div>
      {/* ---------- Header ---------- */}
      <div className="mb-5">
        <Link href="/jobs" className="text-sm text-slate-500 hover:text-slate-800">
          ← Jobs
        </Link>
        <div className="mt-2 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-brand-700">{jobNo(job.number)}</span>
              <JobStatusBadge status={job.status} />
              <PriorityBadge priority={job.priority} />
              {overdue && (
                <span className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
                  <AlertTriangle className="size-3" /> Overdue
                </span>
              )}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{job.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[15px] text-slate-600">
              <Link href={`/customers/${d.customer.id}`} className="inline-flex items-center gap-1.5 font-medium text-slate-800 hover:underline">
                <Building2 className="size-4 text-slate-400" /> {d.customer.name}
              </Link>
              <span className={cn("inline-flex items-center gap-1.5", overdue ? "font-semibold text-red-600" : "")}>
                <CalendarClock className="size-4 text-slate-400" />
                {job.status === "completed" ? `Completed ${fmtDateTime(job.completedAt)}` : `Due ${dueLabel(job.dueDate)}${job.dueDate ? ` (${fmtDate(job.dueDate)})` : ""}`}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Truck className="size-4 text-slate-400" /> {FULFILLMENT_LABELS[job.fulfillment]}
                {job.fulfillmentAt && ` · ${fmtDateTime(job.fulfillmentAt)}`}
              </span>
              <LocationTag code={d.location?.code ?? null} name={d.location?.name ?? null} />
            </div>
          </div>
          <HeaderActions
            job={{ id: job.id, number: job.number, status: job.status, needsDesign: job.needsDesign, needsProof: job.needsProof, needsInstall: job.needsInstall, fulfillment: job.fulfillment, hasArtwork }}
            reorder={{ title: job.title, quantity: first?.quantity ?? 1, priceCents: first?.priceCents ?? 0, itemCount: d.items.length, completedAt: job.completedAt }}
            canStatus={canStatus}
            canEdit={canEdit}
            canReorder={can(r, "jobs.create")}
            canSeeMoney={d.canSeeMoney}
          />
        </div>
        {job.status === "approved_for_production" && !hasArtwork && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">
            <AlertTriangle className="size-4" /> This job is ready for production but has no artwork or production files uploaded.
          </div>
        )}
        {d.reorderOf && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-slate-500">
            <RotateCcw className="size-4" /> Reorder of{" "}
            <Link href={`/jobs/${d.reorderOf.number}`} className="font-medium text-brand-700 hover:underline">
              {jobNo(d.reorderOf.number)}
            </Link>
          </p>
        )}
      </div>

      <LinkTabs tabs={tabs} active={tab} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          {tab === "details" && (
            <>
              <Card>
                <CardHeader
                  title="What we're making"
                  action={canEdit ? <EditJobDialog job={job} categories={categories} locations={locations} contacts={d.contacts} canSeeCost={canSeeCost} /> : undefined}
                />
                <CardBody>
                  {job.description && <p className="mb-3 whitespace-pre-line text-[15px] text-slate-700">{job.description}</p>}
                  <ItemsTable
                    jobId={job.id}
                    items={d.items}
                    categories={categories}
                    canEdit={canEdit}
                    canSeeMoney={d.canSeeMoney}
                    canSeeCost={canSeeCost}
                    totals={{ subtotalCents: job.subtotalCents, taxCents: job.taxCents, totalCents: job.totalCents, estimatedCostCents: job.estimatedCostCents }}
                  />
                </CardBody>
              </Card>
              {(job.internalNotes || job.customerNotes) && (
                <Card>
                  <CardHeader title="Notes" />
                  <CardBody className="space-y-3">
                    {job.internalNotes && (
                      <div className="rounded-lg bg-amber-50 px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Internal — staff only</p>
                        <p className="mt-1 whitespace-pre-line text-[15px] text-slate-800">{job.internalNotes}</p>
                      </div>
                    )}
                    {job.customerNotes && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer-visible</p>
                        <p className="mt-1 whitespace-pre-line text-[15px] text-slate-800">{job.customerNotes}</p>
                      </div>
                    )}
                  </CardBody>
                </Card>
              )}
              {d.proofs.length > 0 && (
                <Card>
                  <CardHeader title="Proofs" action={<Link href={`${base}?tab=files`} className="text-sm font-medium text-brand-600 hover:underline">Manage</Link>} />
                  <CardBody>
                    <ProofsPanel jobId={job.id} proofs={d.proofs.slice(0, 2)} defaultEmail={d.contact?.email ?? d.customer.email} canSend={false} />
                  </CardBody>
                </Card>
              )}
            </>
          )}

          {tab === "files" && (
            <>
              <Card>
                <CardHeader title="Proofs" description="Every version is kept. The approved version is locked." />
                <CardBody>
                  <ProofsPanel jobId={job.id} proofs={d.proofs} defaultEmail={d.contact?.email ?? d.customer.email} canSend={can(r, "proofs.send")} />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Files" />
                <CardBody>
                  <FilesPanel jobId={job.id} files={proofFiles} canUpload={can(r, "files.upload")} />
                </CardBody>
              </Card>
            </>
          )}

          {tab === "chat" && (
            <Card className="xl:hidden">
              <CardHeader title="Job chat" description="Questions, updates and @mentions — kept with the job." />
              <CardBody>
                <JobChat jobId={job.id} jobNumber={job.number} messages={messages} users={chatUsers} currentUserId={user.id} canAttach={can(r, "files.upload")} />
              </CardBody>
            </Card>
          )}

          {tab === "tasks" && (
            <Card>
              <CardHeader title="Tasks for this job" description="Small to-dos like “Call customer about artwork”." />
              <CardBody>
                <TaskList tasks={tasks} users={people} jobId={job.id} emptyText="No tasks for this job." />
              </CardBody>
            </Card>
          )}

          {tab === "money" && showMoneyTab && (
            <MoneyPanel
              jobId={job.id}
              jobNumber={job.number}
              invoices={d.invoices}
              profit={profit}
              expenses={jobExpenses}
              canInvoice={can(r, "money.edit")}
              canSeeCost={canSeeCost}
              canAddExpense={can(r, "expenses.edit")}
              today={t}
            />
          )}

          {tab === "history" && (
            <Card>
              <CardHeader title="History" description="Every change, who made it and when." />
              <CardBody>
                <HistoryPanel activity={d.activity} />
              </CardBody>
            </Card>
          )}
        </div>

        {/* ---------- Right column: who / where / chat ---------- */}
        <div className="space-y-6">
          <Card>
            <CardHeader title="People" />
            <CardBody>
              <Assignments
                jobId={job.id}
                values={{ salespersonId: job.salespersonId, designerId: job.designerId, productionId: job.productionId, installerId: job.installerId }}
                people={people}
                canEdit={canStatus}
                needsInstall={job.needsInstall || job.fulfillment === "install"}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Customer" />
            <CardBody className="space-y-2 text-[15px]">
              <Link href={`/customers/${d.customer.id}`} className="font-semibold text-slate-900 hover:underline">
                {d.customer.name}
              </Link>
              {d.contact && <p className="text-slate-700">{d.contact.name}</p>}
              {(d.contact?.phone ?? d.customer.phone) && (
                <a href={`tel:${d.contact?.phone ?? d.customer.phone}`} className="flex items-center gap-2 text-brand-700 hover:underline">
                  <Phone className="size-4" /> {d.contact?.phone ?? d.customer.phone}
                </a>
              )}
              {(d.contact?.email ?? d.customer.email) && (
                <a href={`mailto:${d.contact?.email ?? d.customer.email}`} className="flex items-center gap-2 truncate text-brand-700 hover:underline">
                  <Mail className="size-4" /> {d.contact?.email ?? d.customer.email}
                </a>
              )}
              {job.siteAddress && (
                <a href={`https://maps.google.com/?q=${encodeURIComponent(job.siteAddress)}`} target="_blank" rel="noreferrer" className="flex items-start gap-2 text-slate-700 hover:underline">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" /> {job.siteAddress}
                </a>
              )}
              {job.siteContact && <p className="text-sm text-slate-600">On site: {job.siteContact}</p>}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {d.customer.taxExempt && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Tax exempt</span>}
                {d.customer.poRequired && (
                  <span className={cn("rounded px-2 py-0.5 text-xs font-medium", job.poNumber ? "bg-slate-100 text-slate-600" : "bg-red-50 text-red-700")}>
                    {job.poNumber ? `PO ${job.poNumber}` : "PO required — missing"}
                  </span>
                )}
                {!d.customer.poRequired && job.poNumber && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">PO {job.poNumber}</span>}
              </div>
              {job.quoteId && (
                <Link href={`/quotes/${job.quoteId}`} className="flex items-center gap-1.5 pt-1 text-sm text-slate-500 hover:text-slate-800">
                  <FileText className="size-4" /> From quote {d.quoteNumber ? quoteNo(d.quoteNumber) : ""}
                </Link>
              )}
            </CardBody>
          </Card>
          {can(r, "messages.use") && (
            <Card className="hidden xl:block">
              <CardHeader title="Job chat" />
              <CardBody>
                <JobChat jobId={job.id} jobNumber={job.number} messages={messages} users={chatUsers} currentUserId={user.id} canAttach={can(r, "files.upload")} listClassName="max-h-[28rem]" />
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
