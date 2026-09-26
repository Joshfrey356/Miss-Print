import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Building2, CalendarClock, Clock } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getQuoteDetail, FOLLOWUP_DAYS } from "@/lib/quotes/queries";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { QuoteStatusBadge } from "@/components/status";
import { QuoteActions } from "@/components/quotes/quote-actions";
import { HistoryPanel } from "@/components/jobs/detail/history-panel";
import { fmtDate, fmtSize, money, pct, quoteNo, timeAgo, today } from "@/lib/format";
import { marginOf } from "@/lib/pricing/engine";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Quote ${(await params).id}` };
}

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("quotes.view");
  const id = Number((await params).id);
  if (!id) notFound();
  const d = await getQuoteDetail(id);
  if (!d) notFound();
  const { quote: q } = d;
  const showMoney = can(user.role, "financials.view");
  const showCost = can(user.role, "margins.view");
  const daysSinceSent = q.sentAt ? Math.floor((Date.now() - q.sentAt.getTime()) / 86400000) : null;
  const expired = q.validUntil && q.validUntil < today() && (q.status === "sent" || q.status === "draft");

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/quotes" className="text-sm text-slate-500 hover:text-slate-800">
        ← Quotes
      </Link>
      <div className="mb-6 mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold text-brand-700">{quoteNo(q.number)}</span>
            <QuoteStatusBadge status={q.status} />
            {q.isRush && <span className="rounded-md bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">Rush</span>}
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{q.title}</h1>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[15px] text-slate-600">
            <Link href={`/customers/${d.customer.id}`} className="inline-flex items-center gap-1.5 font-medium text-slate-800 hover:underline">
              <Building2 className="size-4 text-slate-400" /> {d.customer.name}
            </Link>
            {d.contact?.name && <span>{d.contact.name}</span>}
            {q.dueDate && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="size-4 text-slate-400" /> Needed {fmtDate(q.dueDate)}
              </span>
            )}
            {d.salesperson && <span>Sales: {d.salesperson}</span>}
          </div>
        </div>
        <QuoteActions id={q.id} status={q.status} email={d.contact?.email ?? d.customer.email} canEdit={can(user.role, "quotes.edit")} canConvert={can(user.role, "jobs.create")} jobNumber={d.jobNumber} />
      </div>

      {q.status === "sent" && daysSinceSent != null && daysSinceSent >= FOLLOWUP_DAYS && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[15px] text-amber-900">
          <Clock className="size-5" /> Sent {daysSinceSent} days ago with no answer — time to follow up{d.contact?.phone || d.customer.phone ? ` (${d.contact?.phone ?? d.customer.phone})` : ""}.
        </div>
      )}
      {expired && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-4 py-3 text-[15px] text-slate-700">
          <AlertTriangle className="size-5" /> This quote was valid until {fmtDate(q.validUntil)}. Check prices before accepting.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Items" />
            <CardBody className="divide-y divide-slate-100 py-0">
              {d.items.map(({ item: i, category }) => (
                <div key={i.id} className="flex gap-4 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{i.description}</p>
                    <p className="mt-0.5 text-sm text-slate-600">
                      {[category, `Qty ${i.quantity.toLocaleString()}`, fmtSize(i.widthIn, i.heightIn), i.material, i.finishing].filter(Boolean).join(" · ")}
                    </p>
                    {i.specs && <p className="mt-1 whitespace-pre-line text-sm text-slate-500">{i.specs}</p>}
                    {showMoney && i.priceCents !== i.recommendedCents && (
                      <p className="mt-1 text-xs text-amber-700">
                        Recommended {money(i.recommendedCents)} — changed to {money(i.priceCents)}
                        {i.overrideReason ? `: ${i.overrideReason}` : ""}
                      </p>
                    )}
                  </div>
                  {showMoney && (
                    <div className="text-right">
                      <p className="tabular font-semibold">{money(i.priceCents)}</p>
                      {showCost && i.estimatedCostCents > 0 && <p className="tabular text-xs text-slate-500">margin {pct(marginOf(i.priceCents, i.estimatedCostCents))}</p>}
                    </div>
                  )}
                </div>
              ))}
            </CardBody>
            {showMoney && (
              <div className="border-t border-slate-100 px-5 py-4">
                <dl className="tabular ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-right text-[15px]">
                  <dt className="text-slate-500">Subtotal</dt>
                  <dd>{money(q.subtotalCents)}</dd>
                  <dt className="text-slate-500">{d.customer.taxExempt ? "Tax (exempt)" : "Sales tax"}</dt>
                  <dd>{money(q.taxCents)}</dd>
                  <dt className="text-lg font-semibold">Total</dt>
                  <dd className="text-lg font-semibold">{money(q.totalCents)}</dd>
                  {showCost && q.estimatedCostCents > 0 && (
                    <>
                      <dt className="text-sm text-slate-500">Est. margin</dt>
                      <dd className="text-sm">{pct(marginOf(q.subtotalCents, q.estimatedCostCents))}</dd>
                    </>
                  )}
                </dl>
              </div>
            )}
          </Card>
          {(q.customerNotes || q.internalNotes) && (
            <Card>
              <CardHeader title="Notes" />
              <CardBody className="space-y-3 text-[15px]">
                {q.customerNotes && <p className="whitespace-pre-line text-slate-800">{q.customerNotes}</p>}
                {q.internalNotes && (
                  <div className="rounded-lg bg-amber-50 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Internal</p>
                    <p className="mt-1 whitespace-pre-line text-slate-800">{q.internalNotes}</p>
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Timeline" />
            <CardBody className="space-y-1.5 text-sm text-slate-600">
              <p>Created {fmtDate(q.createdAt.toISOString().slice(0, 10), { year: true })}</p>
              {q.sentAt && <p>Sent {timeAgo(q.sentAt)}</p>}
              {q.respondedAt && <p>Answered {timeAgo(q.respondedAt)}</p>}
              {q.validUntil && <p>Valid until {fmtDate(q.validUntil, { year: true })}</p>}
              {q.lostReason && <p className="text-red-700">Lost: {q.lostReason}</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" />
            <CardBody>
              <HistoryPanel activity={d.activity.filter((a) => showMoney || a.action !== "quote.price_changed")} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
