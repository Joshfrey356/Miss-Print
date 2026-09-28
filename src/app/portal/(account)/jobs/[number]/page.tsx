import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, Check, CheckCircle2, Circle, Download, FileText, MessageSquare, Paperclip, RotateCcw } from "lucide-react";
import { requirePortal } from "@/lib/portal/session";
import { getPortalSettings } from "@/lib/portal/settings";
import { portalJob } from "@/lib/portal/queries";
import { customerTimeline } from "@/lib/portal/rules";
import { getJobPrefix } from "@/lib/tenant";
import { getSettings } from "@/lib/settings";
import { fmtDate, fmtDateTime, fmtSize, invoiceNo, jobNo, money, today } from "@/lib/format";
import { cn } from "@/lib/utils";
import { approvalStatement, shopName } from "@/app/proof/[token]/statement";
import { dueText, Empty, fmtBytes, InvoiceStatusPill, JobStatusPill, Section } from "@/components/portal/parts";
import { PortalUploader } from "@/components/portal/uploader";
import { ProofReview } from "@/components/portal/proof-review";

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }) {
  return { title: `Order ${(await params).number}` };
}

export default async function PortalJobPage({ params }: { params: Promise<{ number: string }> }) {
  const s = await requirePortal();
  const raw = (await params).number;
  if (!/^\d{1,9}$/.test(raw)) notFound();
  const d = await portalJob(s, Number(raw));
  if (!d) notFound();
  const [prefix, { company }, portal] = await Promise.all([getJobPrefix(s.tenantId), getSettings(s.tenantId), getPortalSettings(s.tenantId)]);
  const f = portal.features;
  const { job } = d;
  const steps = customerTimeline(job, d.history);
  const open = job.status !== "completed" && job.status !== "cancelled";
  const toReview = d.proofs.find((p) => p.status === "sent");
  const answered = d.proofs.filter((p) => p !== toReview);
  const now = today();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/portal/jobs" className="text-sm text-slate-500 hover:text-slate-800">
          ← Orders
        </Link>
        <p className="mt-2 text-sm font-medium uppercase tracking-wide text-slate-500">Order {jobNo(job.number, prefix)}</p>
        <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{job.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px] text-slate-600">
          <JobStatusPill status={job.status} fulfillment={job.fulfillment} />
          {job.dueDate && open && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="size-4 text-slate-400" /> {dueText(job.dueDate, now)}
            </span>
          )}
          {job.fulfillmentAt && open && <span>{job.fulfillment === "install" ? "Install" : job.fulfillment === "delivery" ? "Delivery" : "Pickup"}: {fmtDateTime(job.fulfillmentAt)}</span>}
          {job.poNumber && <span>PO {job.poNumber}</span>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {!open && f.reorders && (
            <Link href={`/portal/jobs/${job.number}/reorder`} className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-500 px-4 text-[15px] font-medium text-white shadow-sm hover:bg-brand-600">
              <RotateCcw className="size-4" /> Reorder this
            </Link>
          )}
          {f.messages && <Link href={`/portal/message?job=${job.number}`} className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-[15px] font-medium text-slate-800 shadow-sm hover:bg-slate-50">
            <MessageSquare className="size-4" /> Question about this order?
          </Link>}
        </div>
      </div>

      {toReview && (
        <section id="proof" className="scroll-mt-4 rounded-2xl border-2 border-amber-300 bg-white p-4 shadow-sm sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Please review</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-900">Proof version {toReview.version}</h2>
          {toReview.note && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[15px] text-slate-700">“{toReview.note}”</p>}
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            {toReview.mimeType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/portal/files/${toReview.fileId}`} alt={`Proof V${toReview.version}`} className="mx-auto max-h-[70vh] w-auto" />
            ) : (
              <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                <FileText className="size-10 text-slate-400" />
                <p className="text-[15px] text-slate-700">{toReview.filename.replace(/^Proof V\d+ — /, "")}</p>
              </div>
            )}
          </div>
          <a href={`/api/portal/files/${toReview.fileId}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[15px] font-medium text-brand-700 hover:underline">
            Open the proof full size
          </a>
          <p className="my-4 text-[15px] text-slate-700">Please check everything carefully — spelling, phone numbers, colors and sizes. We print exactly what you approve.</p>
          <ProofReview proofId={toReview.id} defaultName={s.name === s.customerName ? "" : s.name} statement={approvalStatement(shopName(company.name))} />
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Section title="What we're making">
            {d.items.length === 0 ? (
              <Empty>We&apos;ll list the items here once the order is written up.</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {d.items.map((i) => (
                  <li key={i.id} className="px-4 py-3.5 sm:px-5">
                    <p className="text-[15px] font-medium text-slate-900">{i.description}</p>
                    <p className="mt-0.5 text-sm text-slate-600">{[`Qty ${i.quantity.toLocaleString()}`, fmtSize(i.widthIn, i.heightIn), i.material, i.colors, i.finishing].filter(Boolean).join(" · ")}</p>
                    {i.specs && <p className="mt-1 whitespace-pre-line text-sm text-slate-500">{i.specs}</p>}
                  </li>
                ))}
              </ul>
            )}
            {job.customerNotes && <p className="whitespace-pre-line border-t border-slate-100 px-4 py-3 text-[15px] text-slate-700 sm:px-5">{job.customerNotes}</p>}
          </Section>

          {(f.uploads || d.files.length > 0) && <Section title="Your files">
            {d.files.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {d.files.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                    <span className="flex min-w-0 items-center gap-2 text-[15px] text-slate-800">
                      <Paperclip className="size-4 shrink-0 text-slate-400" />
                      <span className="truncate">{f.filename}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-sm text-slate-500">
                      <span className="hidden sm:inline">
                        {fmtBytes(f.sizeBytes)} · {fmtDate(f.createdAt.toISOString().slice(0, 10))}
                      </span>
                      <a href={`/api/portal/files/${f.id}?download=1`} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label={`Download ${f.filename}`}>
                        <Download className="size-4" />
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {f.uploads && (
              <div className={cn("px-4 py-4 sm:px-5", d.files.length > 0 && "border-t border-slate-100")}>
                {open ? <PortalUploader jobId={job.id} /> : <p className="text-[15px] text-slate-500">This order is finished.{f.reorders ? " To send new artwork, use Reorder." : ""}</p>}
              </div>
            )}
          </Section>}

          {answered.length > 0 && (
            <Section title="Proofs">
              <ul className="divide-y divide-slate-100">
                {answered.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium text-slate-900">Proof V{p.version}</p>
                      <p className="text-sm text-slate-600">
                        {p.status === "approved" ? `Approved by ${p.responderName ?? "you"} · ${fmtDateTime(p.respondedAt)}` : `Changes requested · ${fmtDateTime(p.respondedAt)}`}
                      </p>
                      {p.customerComment && <p className="mt-1 text-sm text-slate-500">“{p.customerComment}”</p>}
                    </div>
                    <a href={`/api/portal/files/${p.fileId}`} target="_blank" rel="noreferrer" className="shrink-0 text-sm font-medium text-brand-700 hover:underline">
                      View
                    </a>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="space-y-6">
          <Section title="Progress">
            <ol className="px-4 py-4 sm:px-5">
              {steps.map((st, i) => (
                <li key={st.key} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < steps.length - 1 && <span className={cn("absolute left-[11px] top-6 h-[calc(100%-12px)] w-0.5", st.state === "done" ? "bg-emerald-300" : "bg-slate-200")} aria-hidden />}
                  <span className={cn("relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full", st.state === "done" ? "bg-emerald-500 text-white" : st.state === "current" ? "bg-brand-500 text-white ring-4 ring-brand-100" : "border-2 border-slate-200 bg-white text-slate-300")}>
                    {st.state === "done" ? <Check className="size-3.5" /> : st.state === "current" ? <Circle className="size-2.5 fill-current" /> : null}
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className={cn("text-[15px]", st.state === "current" ? "font-semibold text-slate-900" : st.state === "done" ? "text-slate-800" : "text-slate-400")}>{st.label}</p>
                    {st.at && st.state !== "todo" && <p className="text-xs text-slate-500">{fmtDateTime(st.at)}</p>}
                  </div>
                </li>
              ))}
            </ol>
            {(job.status === "on_hold" || job.status === "cancelled") && (
              <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600 sm:px-5">{job.status === "on_hold" ? "This order is on hold. We'll be in touch — or message us with any questions." : "This order was cancelled."}</p>
            )}
          </Section>

          {d.invoices.length > 0 && (
            <Section title="Invoices">
              <ul className="divide-y divide-slate-100">
                {d.invoices.map((inv) => (
                  <li key={inv.id}>
                    <Link href={`/portal/invoices/${inv.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5">
                      <span className="text-[15px] font-medium text-slate-900">{invoiceNo(inv.number)}</span>
                      <span className="flex items-center gap-2 text-sm">
                        <span className="tabular text-slate-700">{inv.balanceCents > 0 ? `${money(inv.balanceCents)} due` : money(inv.totalCents)}</span>
                        <InvoiceStatusPill status={inv.status} balanceCents={inv.balanceCents} overdue={inv.dueDate < now} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {job.status === "completed" && (
            <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[15px] text-emerald-900">
              <CheckCircle2 className="size-5" /> Finished{job.completedAt ? ` ${fmtDate(job.completedAt.toISOString().slice(0, 10), { year: true })}` : ""}. Thank you!
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
