import { requirePortal } from "@/lib/portal/session";
import { getPortalSettings } from "@/lib/portal/settings";
import { portalQuotes } from "@/lib/portal/queries";
import { fmtDate, money, quoteNo } from "@/lib/format";
import { Empty, QuoteStatusPill, RowLink, Section } from "@/components/portal/parts";

export const metadata = { title: "Quotes" };

export default async function PortalQuotesPage() {
  const s = await requirePortal();
  const [rows, portal] = await Promise.all([portalQuotes(s), getPortalSettings(s.tenantId)]);
  const waiting = rows.filter((q) => q.canAnswer);
  const rest = rows.filter((q) => !q.canAnswer);
  const Row = ({ q }: { q: (typeof rows)[number] }) => (
    <li>
      <RowLink href={`/portal/quotes/${q.id}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-[15px] font-medium text-slate-900">{q.title}</p>
          <QuoteStatusPill status={q.status} expired={q.expired} />
        </div>
        <p className="mt-0.5 text-sm text-slate-500">
          {quoteNo(q.number)} · <span className="tabular">{money(q.totalCents)}</span>
          {q.canAnswer && q.validUntil ? ` · good until ${fmtDate(q.validUntil)}` : ""}
          {q.sentAt && !q.canAnswer ? ` · sent ${fmtDate(q.sentAt.toISOString().slice(0, 10), { year: true })}` : ""}
        </p>
      </RowLink>
    </li>
  );
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Quotes</h1>
      <Section title={portal.features.quotes ? "Waiting for your answer" : "Open quotes"}>
        {waiting.length === 0 ? <Empty>No quotes are waiting for you.</Empty> : <ul className="divide-y divide-slate-100">{waiting.map((q) => <Row key={q.id} q={q} />)}</ul>}
      </Section>
      {rest.length > 0 && (
        <Section title="Earlier quotes">
          <ul className="divide-y divide-slate-100">
            {rest.map((q) => (
              <Row key={q.id} q={q} />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
