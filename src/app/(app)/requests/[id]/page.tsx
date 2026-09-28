import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, CalendarClock, CheckCircle2, Mail, Paperclip, Phone } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getPortalRequest } from "@/lib/portal/staff";
import { REQUEST_KIND_LABELS } from "@/lib/portal/rules";
import { getJobPrefix } from "@/lib/tenant";
import { fmtDate, fmtDateTime, jobNo, quoteNo, today } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/jobs/workflow";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RequestActions } from "./request-actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Request ${(await params).id}` };
}

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("customers.view");
  const raw = (await params).id;
  if (!/^\d{1,9}$/.test(raw)) notFound();
  const d = await getPortalRequest(user.tenantId, Number(raw));
  if (!d) notFound();
  const prefix = await getJobPrefix(user.tenantId);
  const { req } = d;
  const det = d.details;
  const canEdit = can(user.role, "customers.edit");
  const quoteHref = `/quotes/new?${new URLSearchParams({ customerId: String(req.customerId), title: det.what ?? req.subject }).toString()}`;
  const rows: [string, React.ReactNode][] = [];
  if (req.kind === "reorder") {
    rows.push(["Quantity", det.quantity != null ? det.quantity.toLocaleString() : "—"]);
    rows.push(["Artwork", det.sameArtwork ? "Same as last time" : "Has changes"]);
  }
  if (req.kind === "quote") {
    if (det.quantityText) rows.push(["Quantity", det.quantityText]);
    if (det.size) rows.push(["Size", det.size]);
  }
  if (det.neededBy) rows.push(["Needed by", fmtDate(det.neededBy, { year: true })]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        back={{ href: req.status === "handled" ? "/requests?tab=handled" : "/requests", label: "Customer requests" }}
        title={req.subject}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={req.kind === "reorder" ? "violet" : req.kind === "quote" ? "blue" : "gray"}>{REQUEST_KIND_LABELS[req.kind]}</Badge>
            {req.status === "handled" ? <Badge tone="green">Handled</Badge> : <Badge tone="amber">New</Badge>}
            <span>Sent {fmtDateTime(req.createdAt)} from the customer portal</span>
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="What they asked for" />
            <CardBody className="space-y-4">
              {rows.length > 0 && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[15px]">
                  {rows.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-slate-500">{k}</dt>
                      <dd className="font-medium text-slate-900">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {req.body ? <p className="whitespace-pre-line rounded-lg bg-slate-50 px-4 py-3 text-[15px] text-slate-800">{req.body}</p> : rows.length === 0 && <p className="text-[15px] text-slate-500">No message.</p>}
              {d.job && (
                <div className="rounded-lg border border-slate-200 px-4 py-3 text-[15px]">
                  <p className="text-sm text-slate-500">{req.kind === "reorder" ? "Reorder of" : "About"}</p>
                  <Link href={`/jobs/${d.job.number}`} className="font-medium text-brand-700 hover:underline">
                    {jobNo(d.job.number, prefix)} — {d.job.title}
                  </Link>
                  <p className="text-sm text-slate-500">{STATUS_LABELS[d.job.status]}</p>
                  {req.kind === "reorder" && d.sourceItems.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-sm text-slate-600">
                      {d.sourceItems.map((i, idx) => (
                        <li key={idx}>
                          {i.description} — last time {i.quantity.toLocaleString()}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {d.files.length > 0 && (
                <div>
                  <p className="mb-1.5 text-sm font-medium text-slate-700">Files they sent</p>
                  <ul className="space-y-1">
                    {d.files.map((f) => (
                      <li key={f.id}>
                        <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[15px] text-brand-700 hover:underline">
                          <Paperclip className="size-4 text-slate-400" /> {f.filename}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardBody>
          </Card>
          {req.status === "handled" && (
            <Card>
              <CardBody className="flex items-start gap-3 text-[15px] text-slate-700">
                <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" />
                <div>
                  <p>
                    Handled{d.handledByName ? ` by ${d.handledByName}` : ""} {req.handledAt ? fmtDateTime(req.handledAt) : ""}.
                  </p>
                  {d.resultJob && (
                    <p>
                      Job:{" "}
                      <Link href={`/jobs/${d.resultJob.number}`} className="font-medium text-brand-700 hover:underline">
                        {jobNo(d.resultJob.number, prefix)} — {d.resultJob.title}
                      </Link>
                    </p>
                  )}
                  {d.quote && (
                    <p>
                      Quote:{" "}
                      <Link href={`/quotes/${d.quote.id}`} className="font-medium text-brand-700 hover:underline">
                        {quoteNo(d.quote.number)} — {d.quote.title}
                      </Link>
                    </p>
                  )}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Customer" />
            <CardBody className="space-y-1.5 text-[15px]">
              <Link href={`/customers/${req.customerId}`} className="inline-flex items-center gap-2 font-medium text-slate-900 hover:underline">
                <Building2 className="size-4 text-slate-400" /> {d.customerName}
              </Link>
              {req.fromName && req.fromName !== d.customerName && <p className="text-slate-700">{req.fromName}</p>}
              {req.fromEmail && (
                <a href={`mailto:${req.fromEmail}?subject=${encodeURIComponent(`Re: ${req.subject}`)}`} className="flex items-center gap-2 break-all text-slate-700 hover:text-brand-700">
                  <Mail className="size-4 shrink-0 text-slate-400" /> {req.fromEmail}
                </a>
              )}
              {(d.contactPhone || d.customerPhone) && (
                <a href={`tel:${(d.contactPhone || d.customerPhone)!.replace(/[^\d+]/g, "")}`} className="flex items-center gap-2 text-slate-700 hover:text-brand-700">
                  <Phone className="size-4 text-slate-400" /> {d.contactPhone || d.customerPhone}
                </a>
              )}
              {det.neededBy && (
                <p className="flex items-center gap-2 text-slate-700">
                  <CalendarClock className="size-4 text-slate-400" /> Needed {fmtDate(det.neededBy)}
                </p>
              )}
            </CardBody>
          </Card>
          {canEdit && (
            <RequestActions
              id={req.id}
              kind={req.kind}
              status={req.status}
              canCreateJob={can(user.role, "jobs.create")}
              canQuote={can(user.role, "quotes.edit")}
              quoteHref={quoteHref}
              hasResult={Boolean(req.resultJobId)}
              reorder={{ quantity: det.quantity, dueDate: det.neededBy, notes: req.body, sameArtwork: det.sameArtwork, minDate: today() }}
              recentQuotes={d.recentQuotes.map((q) => ({ id: q.id, label: `${quoteNo(q.number)} — ${q.title}` }))}
            />
          )}
        </div>
      </div>
    </div>
  );
}
