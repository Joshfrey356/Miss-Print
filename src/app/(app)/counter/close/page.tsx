import type { Metadata } from "next";
import { History } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { addDays, fmtDate, fmtDateTime, money, today } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/lib/money/labels";
import { getLocations } from "@/lib/lookups";
import { dayTotals, overShort, overShortLabel } from "@/lib/counter/math";
import { dayPayments, lastFloats, listRegisterCloses } from "@/lib/counter/queries";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { CloseForm } from "../_components/close-form";

export const metadata: Metadata = { title: "End of day" };

type Props = { searchParams: Promise<{ date?: string }> };

/** End of day: payments by method for a business date, and the cash drawer count. */
export default async function ClosePage({ searchParams }: Props) {
  const user = await requirePagePermission("counter.use");
  const sp = await searchParams;
  const now = today();
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= now ? sp.date : now;
  const showHistory = can(user.role, "money.view");
  const [pays, closesToday, history, locations, floats] = await Promise.all([
    dayPayments(user.tenantId, date),
    listRegisterCloses(user.tenantId, { date }),
    showHistory ? listRegisterCloses(user.tenantId, { limit: 30 }) : Promise.resolve([]),
    getLocations(user.tenantId),
    lastFloats(user.tenantId),
  ]);
  const d = dayTotals(pays.map((p) => ({ method: p.method, amountCents: p.amountCents })));
  const tenderedCash = pays.filter((p) => p.method === "cash").reduce((a, p) => a + (p.tenderedCents ?? p.amountCents), 0);
  const shopLocations = locations.map((l) => ({ id: l.id, name: l.name }));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        back={{ href: "/counter", label: "Front counter" }}
        title="End of day"
        subtitle={fmtDate(date, { year: true })}
        actions={
          <>
            <LinkButton href={`/counter/close?date=${addDays(date, -1)}`}>Previous day</LinkButton>
            {date < now && <LinkButton href={date === addDays(now, -1) ? "/counter/close" : `/counter/close?date=${addDays(date, 1)}`}>Next day</LinkButton>}
            <form action="/counter/close" className="flex items-center gap-2">
              <input type="date" name="date" defaultValue={date} max={now} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-[15px] shadow-sm" aria-label="Business date" />
              <button type="submit" className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-[15px] font-medium shadow-sm hover:bg-slate-50">
                Go
              </button>
            </form>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Payments by method" description="Everything recorded for this day, at the counter or not. Voided payments are left out." />
          <Table>
            <THead>
              <tr>
                <Th>Method</Th>
                <Th className="text-right">Payments</Th>
                <Th className="text-right">Amount</Th>
              </tr>
            </THead>
            <tbody>
              {PAYMENT_METHODS.map((m) => (
                <Tr key={m} className={d.totals[m] ? undefined : "text-slate-400"}>
                  <Td>{PAYMENT_METHOD_LABELS[m]}</Td>
                  <Td className="text-right tabular">{d.counts[m] ?? 0}</Td>
                  <Td className="text-right text-base font-medium tabular">{money(d.totals[m] ?? 0)}</Td>
                </Tr>
              ))}
              <Tr className="bg-slate-50 font-semibold">
                <Td>Total</Td>
                <Td className="text-right tabular">{pays.length}</Td>
                <Td className="text-right text-lg tabular">{money(d.allCents)}</Td>
              </Tr>
            </tbody>
          </Table>
          <CardBody className="border-t border-slate-100 text-sm text-slate-600">
            Cash taken: <strong className="text-slate-900">{money(d.expectedCashCents)}</strong>
            {tenderedCash > d.expectedCashCents && (
              <> (customers handed over {money(tenderedCash)}; {money(tenderedCash - d.expectedCashCents)} went back as change)</>
            )}
. Expected in the drawer = starting cash + this.
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Count the drawer" />
          <CardBody>
            <CloseForm key={date} date={date} cashTakenCents={d.expectedCashCents} locations={shopLocations} defaultLocationId={user.locationId} lastFloats={floats} />
          </CardBody>
        </Card>
      </div>

      {closesToday.length > 0 && (
        <Card className="mt-5">
          <CardHeader title={`Closed for ${fmtDate(date)}`} description={closesToday.length > 1 ? "More than one count was saved for this day; the newest is first." : undefined} />
          <ClosesTable rows={closesToday} showDate={false} />
        </Card>
      )}

      {showHistory && (
        <Card className="mt-5">
          <CardHeader title="Past closes" description="The last 30 drawer counts." />
          {history.length ? <ClosesTable rows={history} showDate /> : <EmptyState compact icon={History} title="No drawer counts saved yet." />}
        </Card>
      )}
    </div>
  );
}

function ClosesTable({ rows, showDate }: { rows: Awaited<ReturnType<typeof listRegisterCloses>>; showDate: boolean }) {
  return (
    <Table>
      <THead>
        <tr>
          {showDate && <Th>Day</Th>}
          <Th>Location</Th>
          <Th className="text-right">Starting cash</Th>
          <Th className="text-right">Expected cash</Th>
          <Th className="text-right">Counted</Th>
          <Th>Over / short</Th>
          <Th className="text-right">All payments</Th>
          <Th>Closed by</Th>
        </tr>
      </THead>
      <tbody>
        {rows.map(({ c, locationName, closedByName }) => {
          const diff = overShort(c.countedCashCents, c.expectedCashCents);
          const all = Object.values(c.totals).reduce((a, b) => a + b, 0);
          return (
            <Tr key={c.id}>
              {showDate && <Td className="whitespace-nowrap">{fmtDate(c.businessDate, { year: true })}</Td>}
              <Td>{locationName ?? "—"}</Td>
              <Td className="text-right tabular">{money(c.openingFloatCents)}</Td>
              <Td className="text-right tabular">{money(c.expectedCashCents)}</Td>
              <Td className="text-right tabular">{money(c.countedCashCents)}</Td>
              <Td>
                <Badge tone={diff === 0 ? "green" : diff > 0 ? "amber" : "red"}>{overShortLabel(diff, money)}</Badge>
                {c.notes && <p className="mt-1 max-w-xs whitespace-pre-line text-xs text-slate-500">{c.notes}</p>}
              </Td>
              <Td className="text-right tabular">{money(all)}</Td>
              <Td className="whitespace-nowrap text-sm">
                {closedByName ?? "—"}
                <span className="block text-xs text-slate-500">{fmtDateTime(c.createdAt)}</span>
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
