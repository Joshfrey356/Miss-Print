import Link from "next/link";
import QRCode from "qrcode";
import { requirePagePermission } from "@/lib/auth";
import { appUrl } from "@/lib/http";
import { PrintButton } from "@/components/print-button";
import { EmptyState } from "@/components/ui/empty-state";
import { listStock } from "@/lib/inventory/queries";
import { unitLabel } from "@/lib/inventory/math";

export const metadata = { title: "Shelf labels" };

/**
 * Printable shelf labels (2″ × 4″, 10 per letter sheet — Avery 5163/8163) with a QR code that opens
 * the item on a phone, with big Receive / Use buttons.
 */
export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const user = await requirePagePermission("inventory.view");
  const ids = ((await searchParams).ids ?? "")
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 300);
  const rows = (await listStock(user.tenantId, ids.length ? { ids } : {})).filter((r) => r.active);
  // Keep the order they were asked in.
  if (ids.length) rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  const base = await appUrl();
  const labels = await Promise.all(
    rows.map(async (r) => {
      const url = `${base}/inventory/${r.id}?scan=1`;
      const svg = await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
      return { ...r, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` };
    }),
  );

  return (
    <div className="mx-auto max-w-[8.5in] print:-mx-4 print:-mt-6">
      <style>{`@media print { @page { size: letter; margin: 0.5in 0.156in; } }`}</style>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <Link href="/inventory" className="text-sm text-slate-500 hover:text-slate-800">
            ← Inventory
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Shelf labels</h1>
          <p className="mt-1 max-w-xl text-[15px] text-slate-500">
            {labels.length} label{labels.length === 1 ? "" : "s"} · 2″ × 4″, 10 per sheet (Avery 5163 / 8163). Stick one on each shelf or bin; scanning it with a phone camera opens the
            item with big Receive and Use buttons.
          </p>
        </div>
        {labels.length > 0 && <PrintButton />}
      </div>
      {labels.length === 0 ? (
        <EmptyState title="No tracked items to label" description="Start tracking an item first." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 print:grid-cols-[4in_4in] print:gap-x-[0.188in] print:gap-y-0">
          {labels.map((l) => (
            <div key={l.id} className="flex h-[2in] items-center gap-3 overflow-hidden rounded-lg border border-slate-300 bg-white px-3 break-inside-avoid print:rounded-none print:border-dashed print:border-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element -- generated QR code */}
              <img src={l.qr} alt={`QR code for ${l.name}`} className="size-[1.55in] shrink-0" />
              <div className="min-w-0">
                <p className="line-clamp-3 text-lg leading-tight font-bold text-slate-900">{l.name}</p>
                {l.binLocation && <p className="mt-1 truncate text-sm font-semibold text-slate-700">{l.binLocation}</p>}
                <p className="mt-1 text-xs text-slate-600">
                  Counted in {unitLabel(l.unit)}
                  {l.sku ? ` · #${l.sku}` : ""}
                </p>
                <p className="mt-1 text-[10px] text-slate-400">Scan to receive or use · item {l.id}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
