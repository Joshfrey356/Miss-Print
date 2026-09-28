import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { requirePortal } from "@/lib/portal/session";
import { getPortalSettings } from "@/lib/portal/settings";
import { portalQuote } from "@/lib/portal/queries";
import { quoteAnswerable } from "@/lib/portal/rules";
import { getJobPrefix } from "@/lib/tenant";
import { getSettings } from "@/lib/settings";
import { fmtDate, fmtDateTime, fmtSize, jobNo, money, quoteNo, today } from "@/lib/format";
import { quantityChoices } from "@/lib/quotes/print-options";
import { QuoteStatusPill } from "@/components/portal/parts";
import { QuoteResponse } from "@/components/portal/quote-response";
import { PrintButton } from "@/components/print-button";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Quote ${(await params).id}` };
}

export default async function PortalQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePortal();
  const raw = (await params).id;
  if (!/^\d{1,9}$/.test(raw)) notFound();
  const d = await portalQuote(s, Number(raw));
  if (!d) notFound();
  const [prefix, { company }, portal] = await Promise.all([getJobPrefix(s.tenantId), getSettings(s.tenantId), getPortalSettings(s.tenantId)]);
  const { quote: q } = d;
  const now = today();
  const check = quoteAnswerable(q, now);
  const expired = q.status === "expired" || (q.status === "sent" && !!q.validUntil && q.validUntil < now);
  const lines = d.items.map((i) => ({ id: i.id, description: i.description, choices: quantityChoices(i.quantity, i.priceCents, i.options) }));
  const hasChoices = lines.some((l) => l.choices.length > 1);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="print:hidden">
        <Link href="/portal/quotes" className="text-sm text-slate-500 hover:text-slate-800">
          ← Quotes
        </Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Quote {quoteNo(q.number)}</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{q.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-slate-600">
            <QuoteStatusPill status={q.status} expired={expired} />
            {q.validUntil && q.status === "sent" && <span>{expired ? "Expired" : "Good until"} {fmtDate(q.validUntil, { year: true })}</span>}
            {q.dueDate && <span>Needed by {fmtDate(q.dueDate, { year: true })}</span>}
          </div>
        </div>
        <div className="print:hidden">
          <PrintButton />
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <ul className="divide-y divide-slate-100">
          {d.items.map((i, idx) => (
            <li key={i.id} className="flex gap-4 px-4 py-4 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium text-slate-900">{i.description}</p>
                <p className="mt-0.5 text-sm text-slate-600">{[`Qty ${i.quantity.toLocaleString()}`, fmtSize(i.widthIn, i.heightIn), i.material, i.colors, i.finishing].filter(Boolean).join(" · ")}</p>
                {i.specs && <p className="mt-1 whitespace-pre-line text-sm text-slate-500">{i.specs}</p>}
                {lines[idx]!.choices.length > 1 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {lines[idx]!.choices.map((c) => (
                      <span key={c.quantity} className={`tabular rounded-lg border px-2.5 py-1 text-sm ${c.main ? "border-brand-300 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-700"}`}>
                        {c.quantity.toLocaleString()} for <strong className="font-semibold">{money(c.cents)}</strong>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <p className="tabular shrink-0 text-right text-[15px] font-semibold text-slate-900">{money(i.priceCents)}</p>
            </li>
          ))}
        </ul>
        <dl className="tabular ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-t border-slate-100 px-4 py-4 text-right text-[15px] sm:px-5">
          <dt className="text-slate-500">Subtotal</dt>
          <dd>{money(q.subtotalCents)}</dd>
          <dt className="text-slate-500">Sales tax</dt>
          <dd>{money(q.taxCents)}</dd>
          <dt className="text-lg font-semibold">Total</dt>
          <dd className="text-lg font-semibold">{money(q.totalCents)}</dd>
        </dl>
        {hasChoices && <p className="px-4 pb-4 text-right text-xs text-slate-500 sm:px-5">The total is for the quantity shown on each line. Other quantities are priced before tax.</p>}
      </section>

      {q.customerNotes && <p className="whitespace-pre-line rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[15px] text-slate-700 shadow-sm sm:px-5">{q.customerNotes}</p>}

      <div className="print:hidden">
        {check.ok && !portal.features.quotes ? (
          <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-[15px] text-slate-700">
            <Clock className="mt-0.5 size-5 shrink-0 text-slate-400" />
            <span>To accept this quote, reply to our email{company.phone ? ` or call us at ${company.phone}` : ""}.</span>
          </div>
        ) : check.ok ? (
          <QuoteResponse quoteId={q.id} lines={lines} defaultName={s.name === s.customerName ? "" : s.name} total={money(q.totalCents)} />
        ) : q.status === "accepted" || q.status === "converted" ? (
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-[15px] text-emerald-900">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-semibold">
                {q.status === "converted" && d.jobNumber ? (
                  <>
                    This quote is now order{" "}
                    <Link href={`/portal/jobs/${d.jobNumber}`} className="underline">
                      {jobNo(d.jobNumber, prefix)}
                    </Link>
                    .
                  </>
                ) : (
                  <>Accepted{q.responseName ? ` by ${q.responseName}` : ""}{q.respondedAt ? ` on ${fmtDateTime(q.respondedAt)}` : ""}. Thank you!</>
                )}
              </p>
              {q.status === "accepted" && <p className="mt-0.5">We&apos;ll set up your order and let you know the date.</p>}
              {q.responseNote && <p className="mt-1 whitespace-pre-line text-emerald-800">{q.responseNote}</p>}
            </div>
          </div>
        ) : q.status === "declined" ? (
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-[15px] text-slate-700">
            <XCircle className="size-5 text-slate-400" /> You declined this quote{q.respondedAt ? ` on ${fmtDateTime(q.respondedAt)}` : ""}. Changed your mind? Send us a message.
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-[15px] text-slate-700">
            <Clock className="mt-0.5 size-5 shrink-0 text-slate-400" />
            <span>
              {check.reason}
              {company.phone ? ` Call us at ${company.phone}, or ` : " "}
              <Link href="/portal/message" className="font-medium text-brand-700 hover:underline">
                send us a message
              </Link>
              .
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
