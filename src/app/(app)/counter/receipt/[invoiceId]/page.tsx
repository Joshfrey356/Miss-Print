import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getBrand } from "@/lib/brand";
import { getSettings } from "@/lib/settings";
import { fmtDate, fmtDateTime, invoiceNo, jobNo, money } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/money/labels";
import { changeDue } from "@/lib/counter/math";
import { getCounterSale } from "@/lib/counter/queries";
import { Logo } from "@/components/logo";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { AutoPrint } from "../../_components/auto-print";
import { EmailReceiptButton, PrintReceiptButton } from "../../_components/sale-actions";

type Props = { params: Promise<{ invoiceId: string }>; searchParams: Promise<{ print?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ invoiceId }, user] = await Promise.all([params, getCurrentUser()]);
  const s = user && /^\d+$/.test(invoiceId) ? await getCounterSale(user.tenantId, Number(invoiceId)) : null;
  return { title: s ? `Receipt ${invoiceNo(s.inv.number)}` : "Receipt" };
}

/** Printable receipt: sized for an 80 mm receipt printer, fine on a normal printer too. */
export default async function ReceiptPage({ params, searchParams }: Props) {
  const user = await requireUser();
  if (!can(user.role, "counter.use") && !can(user.role, "money.view")) redirect("/no-access");
  const [{ invoiceId }, sp] = await Promise.all([params, searchParams]);
  if (!/^\d{1,9}$/.test(invoiceId)) notFound();
  const sale = await getCounterSale(user.tenantId, Number(invoiceId));
  if (!sale) notFound();
  const [{ company }, brand] = await Promise.all([getSettings(user.tenantId), getBrand(user.tenantId)]);
  const { inv, customer } = sale;
  const isVoid = inv.status === "void";
  const balance = isVoid ? 0 : Math.max(0, inv.totalCents - inv.paidCents);
  const pays = sale.payments.filter((x) => !x.p.voidedAt).map((x) => x.p);
  const walkIn = customer.name === "Walk-in";
  const when = pays.length ? pays[pays.length - 1]!.createdAt : inv.createdAt;
  const anyUntaxed = sale.items.some((i) => !i.taxable);
  const rate = inv.taxRate ? ` (${(inv.taxRate * 100).toFixed(2).replace(/\.?0+$/, "")}%)` : "";

  return (
    <div>
      <AutoPrint enabled={sp.print === "1"} />
      <style>{`
        @media print {
          @page { size: 80mm auto; margin: 3mm; }
          html, body { background: #fff !important; }
          aside, header, nav, [data-sonner-toaster], .no-print { display: none !important; }
          main { padding: 0 !important; margin: 0 !important; max-width: none !important; }
          .min-h-dvh { padding-left: 0 !important; }
          .receipt { box-shadow: none !important; border: 0 !important; border-radius: 0 !important; margin: 0 auto !important; padding: 0 !important; width: 100% !important; max-width: 80mm !important; }
        }
      `}</style>
      <div className="no-print">
        <PageHeader
          back={{ href: inv.source === "counter" ? "/counter?tab=today" : "/counter", label: "Front counter" }}
          title={`Receipt · ${invoiceNo(inv.number)}`}
          actions={
            <>
              <PrintReceiptButton />
              <EmailReceiptButton invoiceId={inv.id} defaultEmail={walkIn ? null : customer.email} />
              {balance > 0 && can(user.role, "counter.use") && (
                <LinkButton href={`/counter/sale/${inv.id}`} size="lg" variant="success">
                  Take payment
                </LinkButton>
              )}
              {can(user.role, "counter.use") && (
                <LinkButton href="/counter" size="lg">
                  <Plus className="size-5" />
                  New sale
                </LinkButton>
              )}
            </>
          }
        />
      </div>

      <div className="receipt mx-auto w-full max-w-[22rem] rounded-xl border border-slate-200 bg-white p-5 font-mono text-[13px] leading-snug text-black shadow-sm">
        <div className="text-center font-sans">
          <div className="flex justify-center">
            <Logo brand={brand} className="max-h-14 items-center text-center" />
          </div>
          {company.address && <p className="mt-2 text-[12px]">{company.address}</p>}
          {company.phone && <p className="text-[12px]">{company.phone}</p>}
        </div>
        <Divider />
        <div className="flex justify-between">
          <span className="font-bold">{isVoid ? "VOID" : balance > 0 ? "INVOICE" : "RECEIPT"}</span>
          <span>{invoiceNo(inv.number)}</span>
        </div>
        <p>{fmtDateTime(when)}</p>
        {!walkIn && <p>{customer.name}</p>}
        {inv.poNumber && <p>PO {inv.poNumber}</p>}
        <Divider />
        {sale.items.map((it) => {
          const amount = (
            <span className="shrink-0 tabular">
              {money(it.amountCents)}
              {anyUntaxed && <span className="inline-block w-[1.5ch] text-right">{it.taxable ? "" : "N"}</span>}
            </span>
          );
          const each = it.quantity > 1 && it.amountCents % it.quantity === 0 ? ` @ ${money(it.amountCents / it.quantity)}` : "";
          return it.quantity > 1 ? (
            <div key={it.id} className="py-0.5">
              <p className="break-words">{it.description}</p>
              <div className="flex justify-between gap-3">
                <span className="pl-2">
                  {it.quantity.toLocaleString()}
                  {each || " pcs"}
                </span>
                {amount}
              </div>
            </div>
          ) : (
            <div key={it.id} className="flex justify-between gap-3 py-0.5">
              <span className="break-words">{it.description}</span>
              {amount}
            </div>
          );
        })}
        <Divider />
        <Line label="Subtotal" value={money(inv.subtotalCents)} pad={anyUntaxed} />
        <Line label={`Tax${rate}`} value={money(inv.taxCents)} pad={anyUntaxed} />
        <Line label="TOTAL" value={money(inv.totalCents)} bold pad={anyUntaxed} />
        {pays.length > 0 && <Divider />}
        {pays.map((p) => (
          <div key={p.id}>
            <Line label={`${PAYMENT_METHOD_LABELS[p.method]}${p.reference ? ` ${p.reference}` : ""}`} value={money(p.amountCents)} pad={anyUntaxed} />
            {changeDue(p) > 0 && (
              <>
                <Line label="  Cash given" value={money(p.tenderedCents)} pad={anyUntaxed} />
                <Line label="  Change" value={money(changeDue(p))} bold pad={anyUntaxed} />
              </>
            )}
          </div>
        ))}
        <Divider />
        {isVoid ? (
          <p className="text-center font-bold">SALE CANCELLED</p>
        ) : balance > 0 ? (
          <>
            <Line label="BALANCE DUE" value={money(balance)} bold pad={anyUntaxed} />
            <p className="text-[12px]">Due {fmtDate(inv.dueDate, { year: true })}</p>
          </>
        ) : (
          <p className="text-center text-[15px] font-bold">PAID IN FULL</p>
        )}
        {sale.job && (
          <p className="mt-2 text-center">
            Your order: <strong>{jobNo(sale.job.number, brand.jobPrefix)}</strong>
            <br />
            We&apos;ll let you know when it&apos;s ready.
          </p>
        )}
        {inv.notes && <p className="mt-2 whitespace-pre-line">{inv.notes}</p>}
        {anyUntaxed && <p className="mt-1 text-[11px]">N = not taxed</p>}
        <Divider />
        <div className="text-center font-sans text-[12px]">
          <p className="font-semibold">Thank you!</p>
          {company.website && <p>{company.website.replace(/^https?:\/\//, "")}</p>}
          {company.hours && <p>{company.hours}</p>}
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="my-2 border-t border-dashed border-black/60" />;
}

function Line({ label, value, bold, pad }: { label: string; value: string; bold?: boolean; pad?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? "font-bold" : ""}`}>
      <span className="whitespace-pre">{label}</span>
      <span className="tabular">
        {value}
        {pad && <span className="inline-block w-[1.5ch]" />}
      </span>
    </div>
  );
}
