import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getQuoteDetail } from "@/lib/quotes/queries";
import { getBrand } from "@/lib/brand";
import { getSettings } from "@/lib/settings";
import { Logo } from "@/components/logo";
import { PrintButton } from "@/components/print-button";
import { fmtDate, fmtSize, money, quoteNo } from "@/lib/format";
import { quantityChoices, sidesLabel, type StoredBreakdown } from "@/lib/quotes/print-options";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Print quote ${(await params).id}` };
}

/** The customer's copy of a quote, ready to print or save as PDF. Prices only — never costs or margins. */
export default async function QuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("quotes.view");
  const id = Number((await params).id);
  if (!id) notFound();
  if (!can(user.role, "financials.view")) {
    return <p className="mx-auto max-w-xl py-16 text-center text-[15px] text-slate-600">Printing a quote shows its prices, so it&apos;s only for people who can see prices.</p>;
  }
  const d = await getQuoteDetail(user.tenantId, id);
  if (!d) notFound();
  const [brand, { company }] = await Promise.all([getBrand(user.tenantId), getSettings(user.tenantId)]);
  const { quote: q } = d;
  const hasChoices = d.items.some(({ item: i }) => ((i.pricingBreakdown as StoredBreakdown | null)?.quantityOptions ?? []).some((o) => o.quantity !== i.quantity));

  return (
    <div className="mx-auto max-w-3xl bg-white p-6 text-slate-900 sm:p-8 print:max-w-none print:p-0">
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>
      <div className="flex flex-col gap-4 border-b-2 border-slate-900 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Logo brand={brand} />
          <div className="mt-2 text-sm text-slate-600">
            {company.address && <p className="whitespace-pre-line">{company.address}</p>}
            <p>{[company.phone, company.email, company.website].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <div className="sm:text-right">
          <p className="text-3xl font-black tracking-tight">QUOTE</p>
          <p className="text-lg font-semibold">{quoteNo(q.number)}</p>
          <p className="text-sm text-slate-600">Date {fmtDate((q.sentAt ?? q.createdAt).toISOString().slice(0, 10), { year: true, weekday: false })}</p>
          {q.validUntil && <p className="text-sm text-slate-600">Valid until {fmtDate(q.validUntil, { year: true, weekday: false })}</p>}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 text-[15px] sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Prepared for</p>
          <p className="font-semibold">{d.customer.name}</p>
          {d.contact?.name && <p>{d.contact.name}</p>}
          {(d.contact?.email ?? d.customer.email) && <p className="text-slate-600">{d.contact?.email ?? d.customer.email}</p>}
        </div>
        <div className="sm:text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Project</p>
          <p className="font-semibold">{q.title}</p>
          {q.dueDate && <p className="text-slate-600">Needed by {fmtDate(q.dueDate, { year: true })}</p>}
          {d.salesperson && <p className="text-slate-600">Your contact: {d.salesperson}</p>}
        </div>
      </div>

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-slate-900 text-left">
            <th className="py-1.5 pr-3">Item</th>
            <th className="py-1.5 pr-3 text-right">Qty</th>
            <th className="py-1.5 text-right">Price</th>
          </tr>
        </thead>
        <tbody>
          {d.items.map(({ item: i }) => {
            const pb = i.pricingBreakdown as StoredBreakdown | null;
            const run = pb?.production;
            const choices = pb?.quantityOptions?.length ? quantityChoices(i.quantity, i.priceCents, pb.quantityOptions) : [];
            const details = [fmtSize(i.widthIn, i.heightIn), i.material, run ? sidesLabel(run.pages) : null, i.colors ? `${i.colors} ink` : null, run?.bleed ? "full bleed" : null, i.finishing].filter(Boolean);
            return (
              <tr key={i.id} className="border-b border-slate-300 align-top">
                <td className="py-2.5 pr-3">
                  <p className="font-semibold">{i.description}</p>
                  {details.length > 0 && <p className="text-slate-600">{details.join(" · ")}</p>}
                  {i.specs && <p className="whitespace-pre-line text-slate-600">{i.specs}</p>}
                  {choices.length > 1 && (
                    <p className="tabular mt-1.5 text-slate-800">
                      <span className="font-medium">Choose your quantity: </span>
                      {choices.map((c, idx) => (
                        <span key={c.quantity}>
                          {idx > 0 && " · "}
                          <span className={c.main ? "font-semibold" : undefined}>
                            {c.quantity.toLocaleString()} for {money(c.cents)}
                          </span>
                        </span>
                      ))}
                    </p>
                  )}
                </td>
                <td className="tabular py-2.5 pr-3 text-right">{i.quantity.toLocaleString()}</td>
                <td className="tabular py-2.5 text-right font-medium">{money(i.priceCents)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <dl className="tabular ml-auto mt-4 grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-right text-[15px]">
        <dt className="text-slate-600">Subtotal</dt>
        <dd>{money(q.subtotalCents)}</dd>
        <dt className="text-slate-600">{d.customer.taxExempt ? "Sales tax (exempt)" : "Sales tax"}</dt>
        <dd>{money(q.taxCents)}</dd>
        <dt className="text-lg font-bold">Total</dt>
        <dd className="text-lg font-bold">{money(q.totalCents)}</dd>
      </dl>
      {hasChoices && <p className="mt-2 text-right text-xs text-slate-500">The total is for the quantity shown on each line. Other quantities are priced before tax.</p>}

      {q.customerNotes && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</p>
          <p className="whitespace-pre-line text-[15px]">{q.customerNotes}</p>
        </div>
      )}
      <p className="mt-8 border-t border-slate-300 pt-3 text-sm text-slate-600">
        To approve, reply to this quote{company.phone ? ` or call ${company.phone}` : ""}. Thank you for the opportunity!
      </p>
    </div>
  );
}
