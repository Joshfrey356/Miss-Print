import { requirePortal } from "@/lib/portal/session";
import { portalInvoices } from "@/lib/portal/queries";
import { fmtDate, invoiceNo, money, today } from "@/lib/format";
import { Empty, InvoiceStatusPill, RowLink, Section } from "@/components/portal/parts";

export const metadata = { title: "Invoices" };

export default async function PortalInvoicesPage() {
  const s = await requirePortal();
  const rows = await portalInvoices(s);
  const now = today();
  const owed = rows.reduce((a, r) => a + Math.max(0, r.balanceCents), 0);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Invoices</h1>
        <p className="mt-1 text-[15px] text-slate-600">{owed > 0 ? <>Balance due: <strong className="tabular font-semibold text-slate-900">{money(owed)}</strong></> : "You're all paid up. Thank you!"}</p>
      </div>
      <Section title="All invoices">
        {rows.length === 0 ? (
          <Empty>No invoices yet.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((i) => (
              <li key={i.id}>
                <RowLink href={`/portal/invoices/${i.id}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[15px] font-medium text-slate-900">{invoiceNo(i.number)}</p>
                    <p className="tabular text-[15px] font-semibold text-slate-900">{i.balanceCents > 0 ? money(i.balanceCents) : money(i.totalCents)}</p>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-sm text-slate-500">
                      {fmtDate(i.issueDate, { year: true })}
                      {i.jobTitle ? ` · ${i.jobTitle}` : ""}
                    </p>
                    <InvoiceStatusPill status={i.status} balanceCents={i.balanceCents} overdue={i.dueDate < now} />
                  </div>
                </RowLink>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
