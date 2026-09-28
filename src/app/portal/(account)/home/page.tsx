import Link from "next/link";
import { CalendarClock, CheckCircle2, FileSignature, FileText, MessageSquare, Plus, Receipt, RotateCcw } from "lucide-react";
import { requirePortal } from "@/lib/portal/session";
import { getPortalSettings } from "@/lib/portal/settings";
import { portalInvoices, portalJobs, portalQuotes, portalRequestsFor, proofsWaiting } from "@/lib/portal/queries";
import { getJobPrefix } from "@/lib/tenant";
import { fmtDate, invoiceNo, jobNo, money, quoteNo, timeAgo, today } from "@/lib/format";
import { REQUEST_KIND_LABELS } from "@/lib/portal/rules";
import { Badge } from "@/components/ui/badge";
import { dueText, Empty, JobStatusPill, RowLink, Section } from "@/components/portal/parts";

export const metadata = { title: "Home" };

export default async function PortalHome() {
  const s = await requirePortal();
  const [portal, prefix, open, past, proofs, quotes, invoices, requests] = await Promise.all([
    getPortalSettings(s.tenantId),
    getJobPrefix(s.tenantId),
    portalJobs(s, "open", 50),
    portalJobs(s, "past", 8),
    proofsWaiting(s),
    portalQuotes(s),
    portalInvoices(s),
    portalRequestsFor(s, 5),
  ]);
  const now = today();
  const f = portal.features;
  const quotesWaiting = f.quotes ? quotes.filter((q) => q.canAnswer) : [];
  const unpaid = invoices.filter((i) => i.balanceCents > 0);
  const waiting = proofs.length + quotesWaiting.length + unpaid.length;
  const first = s.name.split(" ")[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Hi {first}</h1>
          <p className="mt-1 text-[15px] text-slate-600">{waiting ? `${waiting} ${waiting === 1 ? "thing needs" : "things need"} your attention.` : "Nothing needs your attention right now."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {f.quoteRequests && (
          <Link href="/portal/request" className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-500 px-4 text-[15px] font-medium text-white shadow-sm hover:bg-brand-600">
            <Plus className="size-4" /> Request a quote
          </Link>
          )}
          {f.messages && (
          <Link href="/portal/message" className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-[15px] font-medium text-slate-800 shadow-sm hover:bg-slate-50">
            <MessageSquare className="size-4" /> Message us
          </Link>
          )}
        </div>
      </div>

      {portal.welcome && <p className="whitespace-pre-line rounded-2xl border border-brand-100 bg-brand-50 px-4 py-3 text-[15px] text-slate-800 sm:px-5">{portal.welcome}</p>}

      {waiting > 0 && (
        <Section title="Waiting on you">
          <ul className="divide-y divide-slate-100">
            {proofs.map((p) => (
              <li key={`p${p.id}`}>
                <RowLink href={`/portal/jobs/${p.jobNumber}#proof`}>
                  <p className="flex items-center gap-2 text-[15px] font-medium text-slate-900">
                    <FileSignature className="size-4 shrink-0 text-amber-600" /> Review proof V{p.version}: {p.jobTitle}
                  </p>
                  <p className="text-sm text-slate-500">
                    {jobNo(p.jobNumber, prefix)} · sent {timeAgo(p.sentAt ?? new Date())}
                  </p>
                </RowLink>
              </li>
            ))}
            {quotesWaiting.map((q) => (
              <li key={`q${q.id}`}>
                <RowLink href={`/portal/quotes/${q.id}`}>
                  <p className="flex items-center gap-2 text-[15px] font-medium text-slate-900">
                    <FileText className="size-4 shrink-0 text-amber-600" /> Quote to accept: {q.title}
                  </p>
                  <p className="text-sm text-slate-500">
                    {quoteNo(q.number)} · {money(q.totalCents)}
                    {q.validUntil ? ` · good until ${fmtDate(q.validUntil)}` : ""}
                  </p>
                </RowLink>
              </li>
            ))}
            {unpaid.map((i) => (
              <li key={`i${i.id}`}>
                <RowLink href={`/portal/invoices/${i.id}`}>
                  <p className="flex items-center gap-2 text-[15px] font-medium text-slate-900">
                    <Receipt className="size-4 shrink-0 text-amber-600" /> Invoice {invoiceNo(i.number)}: {money(i.balanceCents)} due
                  </p>
                  <p className={i.dueDate < now ? "text-sm font-medium text-red-700" : "text-sm text-slate-500"}>
                    {i.dueDate < now ? `Was due ${fmtDate(i.dueDate)}` : `Due ${fmtDate(i.dueDate)}`}
                    {i.jobTitle ? ` · ${i.jobTitle}` : ""}
                  </p>
                </RowLink>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Open orders" action={<Link href="/portal/jobs" className="text-sm font-medium text-brand-700 hover:underline">All orders</Link>}>
        {open.length === 0 ? (
          <Empty>You have no open orders right now.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {open.map((j) => (
              <li key={j.id}>
                <RowLink href={`/portal/jobs/${j.number}`}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-[15px] font-medium text-slate-900">{j.title}</p>
                    <JobStatusPill status={j.status} fulfillment={j.fulfillment} />
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-slate-500">
                    <span>{jobNo(j.number, prefix)}</span>
                    {j.dueDate && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="size-3.5" /> {dueText(j.dueDate, now)}
                      </span>
                    )}
                    {j.poNumber && <span>PO {j.poNumber}</span>}
                  </p>
                </RowLink>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recent orders">
        {past.length === 0 ? (
          <Empty>Your finished orders will show here{f.reorders ? ", ready to reorder" : ""}.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {past.map((j) => (
              <li key={j.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Link href={`/portal/jobs/${j.number}`} className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-slate-900 hover:underline">{j.title}</p>
                  <p className="text-sm text-slate-500">
                    {jobNo(j.number, prefix)}
                    {j.completedAt ? ` · finished ${fmtDate(j.completedAt.toISOString().slice(0, 10), { year: true })}` : ""}
                  </p>
                </Link>
                {f.reorders && <Link href={`/portal/jobs/${j.number}/reorder`} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50">
                  <RotateCcw className="size-4" /> Reorder
                </Link>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {requests.length > 0 && (
        <Section title="Your requests">
          <ul className="divide-y divide-slate-100">
            {requests.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-slate-900">{r.subject}</p>
                  <p className="text-sm text-slate-500">
                    {REQUEST_KIND_LABELS[r.kind]} · sent {timeAgo(r.createdAt)}
                    {r.resultJobNumber ? ` · order ${jobNo(r.resultJobNumber, prefix)}` : ""}
                  </p>
                </div>
                {r.status === "handled" ? (
                  <Badge tone="green" className="text-[13px]">
                    <CheckCircle2 className="size-3.5" /> Done
                  </Badge>
                ) : (
                  <Badge tone="blue" className="text-[13px]">Received</Badge>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
