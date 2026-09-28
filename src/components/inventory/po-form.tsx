"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, PackagePlus, Plus, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, MoneyInput, Select, Textarea } from "@/components/ui/input";
import { useJobNo } from "@/components/shop-context";
import { centsToInput, money, parseMoney, plural } from "@/lib/format";
import { lineAmount, parseQty, parseUnitCost, poTotals, unitCostToInput, unitLabel } from "@/lib/inventory/math";
import { savePoAction } from "@/app/(app)/inventory/actions";
import { VendorDialog } from "./vendor-dialog";

export type PoFormMaterial = { id: number; name: string; unit: string; sku: string | null; vendorId: number | null; tracked: boolean; unitCostCents: number };
export type PoFormOptions = {
  vendors: { id: number; name: string; email: string | null }[];
  locations: { id: number; name: string }[];
  materials: PoFormMaterial[];
  jobs: { id: number; number: number; title: string }[];
};
export type PoFormValue = {
  vendorId: number | null;
  locationId: number | null;
  expectedOn: string | null;
  jobId: number | null;
  notes: string | null;
  shippingCents: number;
  taxCents: number;
  lines: { materialId: number | null; description: string; quantity: number; unit: string | null; unitCostCents: number; jobId: number | null }[];
};

type Line = { key: number; materialId: number | null; description: string; qty: string; unit: string; cost: string; jobId: string };

let seq = 0;
const blankLine = (m?: PoFormMaterial, qty?: number): Line => ({
  key: ++seq,
  materialId: m?.id ?? null,
  description: m ? m.name : "",
  qty: qty ? String(qty) : "",
  unit: m?.unit ?? "each",
  cost: m ? unitCostToInput(m.unitCostCents) : "",
  jobId: "",
});

/** New / edit a draft purchase order. */
export function PoForm({ id, initial, options }: { id: number | null; initial: PoFormValue; options: PoFormOptions }) {
  const router = useRouter();
  const jobNo = useJobNo();
  const [vendors, setVendors] = React.useState(options.vendors);
  const [vendorId, setVendorId] = React.useState(initial.vendorId ? String(initial.vendorId) : "");
  const [locationId, setLocationId] = React.useState(initial.locationId ? String(initial.locationId) : options.locations[0] ? String(options.locations[0].id) : "");
  const [expectedOn, setExpectedOn] = React.useState(initial.expectedOn ?? "");
  const [jobId, setJobId] = React.useState(initial.jobId ? String(initial.jobId) : "");
  const [notes, setNotes] = React.useState(initial.notes ?? "");
  const [shipping, setShipping] = React.useState(initial.shippingCents ? centsToInput(initial.shippingCents) : "");
  const [tax, setTax] = React.useState(initial.taxCents ? centsToInput(initial.taxCents) : "");
  const [lines, setLines] = React.useState<Line[]>(() =>
    initial.lines.length
      ? initial.lines.map((l) => ({ key: ++seq, materialId: l.materialId, description: l.description, qty: String(l.quantity), unit: l.unit ?? "", cost: unitCostToInput(l.unitCostCents), jobId: l.jobId ? String(l.jobId) : "" }))
      : [blankLine()],
  );
  const [addingVendor, setAddingVendor] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  const matById = new Map(options.materials.map((m) => [m.id, m]));
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const parsed = lines.map((l) => ({ quantity: parseQty(l.qty) ?? 0, unitCostCents: parseUnitCost(l.cost) ?? 0 }));
  const shipCents = parseMoney(shipping) ?? 0;
  const taxCents = parseMoney(tax) ?? 0;
  const totals = poTotals(parsed, shipCents, taxCents);
  const vendorMaterials = vendorId ? options.materials.filter((m) => String(m.vendorId) === vendorId && m.tracked && !lines.some((l) => l.materialId === m.id)) : [];
  const tracked = options.materials.filter((m) => m.tracked);
  const untracked = options.materials.filter((m) => !m.tracked);

  const save = () => {
    setError(null);
    const value: PoFormValue = {
      vendorId: Number(vendorId) || null,
      locationId: Number(locationId) || null,
      expectedOn: expectedOn || null,
      jobId: Number(jobId) || null,
      notes: notes.trim() || null,
      shippingCents: shipCents,
      taxCents,
      lines: lines
        .filter((l) => l.description.trim() || l.materialId)
        .map((l) => ({
          materialId: l.materialId,
          description: l.description.trim(),
          quantity: parseQty(l.qty) ?? 0,
          unit: l.unit.trim() || null,
          unitCostCents: parseUnitCost(l.cost) ?? 0,
          jobId: Number(l.jobId) || null,
        })),
    };
    if (!value.vendorId) return setError("Choose a vendor.");
    if (!value.lines.length) return setError("Add at least one line to the order.");
    const bad = value.lines.find((l) => !(l.quantity > 0));
    if (bad) return setError(`Enter a quantity for “${bad.description || "the new line"}”.`);
    start(async () => {
      const r = await savePoAction(id, value as Parameters<typeof savePoAction>[1]);
      if (!r.ok) return setError(r.error);
      toast.success(r.message ?? "Saved");
      router.push(`/inventory/purchase-orders/${r.data!.id}`);
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Order details" />
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Vendor" htmlFor="po-vendor" required>
            <Select id="po-vendor" value={vendorId} onChange={(e) => (e.target.value === "new" ? setAddingVendor(true) : setVendorId(e.target.value))}>
              <option value="">Choose…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
              <option value="new">+ Add a new vendor…</option>
            </Select>
          </Field>
          <Field label="Deliver to" htmlFor="po-loc">
            <Select id="po-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">—</option>
              {options.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Needed by" htmlFor="po-exp">
            <Input id="po-exp" type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} />
          </Field>
          <Field label="For a job (optional)" htmlFor="po-job" hint="Charges the whole order to the job's cost.">
            <Select id="po-job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">Stock / not for one job</option>
              {options.jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {jobNo(j.number)} · {j.title}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="What we're ordering" description="Stock items come in with their unit and last cost. Use “Other” for outside services and one-off items." />
        <CardBody className="space-y-3">
          {vendorMaterials.length > 0 && (
            <div className="rounded-lg bg-slate-50 px-3 py-2.5">
              <p className="mb-1.5 text-sm text-slate-600">Usually bought from this vendor:</p>
              <div className="flex flex-wrap gap-1.5">
                {vendorMaterials.slice(0, 12).map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => setLines((ls) => [...ls.filter((l) => l.description.trim() || l.materialId), blankLine(m)])}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-100"
                  >
                    <Plus className="size-3.5" /> {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="hidden grid-cols-[minmax(0,2.4fr)_7rem_minmax(0,1.3fr)_7rem_minmax(0,1.4fr)_2.5rem] gap-2 px-1 text-xs font-medium uppercase tracking-wide text-slate-500 lg:grid">
            <span>Item</span>
            <span className="text-right">Qty</span>
            <span>Cost per unit</span>
            <span className="text-right">Amount</span>
            <span>Job</span>
            <span />
          </div>
          {lines.map((l, i) => {
            const m = l.materialId ? matById.get(l.materialId) : undefined;
            const amount = lineAmount(parsed[i]!.quantity, parsed[i]!.unitCostCents);
            const perM = l.unit === "sheet" && parsed[i]!.unitCostCents > 0 ? parsed[i]!.unitCostCents * 1000 : null;
            return (
              <div key={l.key} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3 lg:grid-cols-[minmax(0,2.4fr)_7rem_minmax(0,1.3fr)_7rem_minmax(0,1.4fr)_2.5rem] lg:items-start lg:border-0 lg:p-1">
                <div className="col-span-2 space-y-1.5 lg:col-span-1">
                  <Select
                    aria-label="Item"
                    value={l.materialId ?? ""}
                    onChange={(e) => {
                      const nm = matById.get(Number(e.target.value));
                      update(l.key, nm ? { materialId: nm.id, description: nm.name, unit: nm.unit, cost: unitCostToInput(nm.unitCostCents) } : { materialId: null, unit: l.materialId ? "each" : l.unit, description: l.materialId ? "" : l.description });
                    }}
                  >
                    <option value="">Other / outside service</option>
                    {tracked.length > 0 && (
                      <optgroup label="Tracked stock">
                        {tracked.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Other materials">
                      {untracked.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </optgroup>
                  </Select>
                  <Input aria-label="Description" value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} placeholder={m ? m.name : "e.g. Die cutting (outside service)"} />
                  {m?.sku && <p className="text-xs text-slate-500">Vendor item # {m.sku}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500 lg:hidden">Quantity</label>
                  <Input aria-label="Quantity" inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} className="text-right tabular" placeholder="0" />
                  <p className="mt-1 text-right text-xs text-slate-500">
                    {m ? unitLabel(l.unit, parsed[i]!.quantity) : <input aria-label="Unit" value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value })} className="w-16 border-b border-dashed border-slate-300 bg-transparent text-right text-xs outline-none" placeholder="unit" />}
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500 lg:hidden">Cost per {unitLabel(l.unit, 1)}</label>
                  <MoneyInput aria-label="Cost per unit" value={l.cost} onChange={(e) => update(l.key, { cost: e.target.value })} placeholder="0.00" />
                  {perM != null && <p className="mt-1 text-xs text-slate-500">= {money(Math.round(perM))} per 1,000</p>}
                </div>
                <div className="text-right lg:pt-2.5">
                  <label className="mb-1 block text-xs text-slate-500 lg:hidden">Amount</label>
                  <span className="font-medium tabular text-slate-900">{money(amount)}</span>
                </div>
                <div className="col-span-2 lg:col-span-1">
                  <label className="mb-1 block text-xs text-slate-500 lg:hidden">For job (optional)</label>
                  <Select aria-label="For job" value={l.jobId} onChange={(e) => update(l.key, { jobId: e.target.value })} className="text-sm">
                    <option value="">{jobId ? "Same as order" : "—"}</option>
                    {options.jobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {jobNo(j.number)} · {j.title}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="col-span-2 flex justify-end lg:col-span-1 lg:pt-1">
                  <Button variant="ghost" size="sm" aria-label="Remove line" onClick={() => setLines((ls) => (ls.length === 1 ? [blankLine()] : ls.filter((x) => x.key !== l.key)))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={() => setLines((ls) => [...ls, blankLine()])}>
              <PackagePlus className="size-4" /> Add a line
            </Button>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader title="Notes for the vendor" />
          <CardBody>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="e.g. Deliver to the back door. Call Rick at 219-555-0100 when you're 30 minutes out." />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center justify-between text-[15px]">
              <span className="text-slate-600">Items</span>
              <span className="tabular">{money(totals.subtotalCents)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-[15px]">
              <label htmlFor="po-ship" className="inline-flex items-center gap-1.5 text-slate-600">
                <Truck className="size-4" /> Shipping
              </label>
              <div className="w-32">
                <MoneyInput id="po-ship" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0.00" className="text-right" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 text-[15px]">
              <label htmlFor="po-tax" className="text-slate-600">
                Tax
              </label>
              <div className="w-32">
                <MoneyInput id="po-tax" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0.00" className="text-right" />
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-lg font-semibold">
              <span>Total</span>
              <span className="tabular">{money(totals.totalCents)}</span>
            </div>
            <p className="text-sm text-slate-500">
              {plural(lines.filter((l) => l.description.trim() || l.materialId).length, "line")}. Saved as a draft — nothing is sent until you place the order.
            </p>
          </CardBody>
        </Card>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[15px] font-medium text-red-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={() => router.back()}>Cancel</Button>
        <Button variant="primary" size="lg" onClick={save} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {id ? "Save changes" : "Save draft"}
        </Button>
      </div>

      <VendorDialog
        open={addingVendor}
        onOpenChange={setAddingVendor}
        onSaved={(v) => {
          setVendors((vs) => [...vs.filter((x) => x.id !== v.id), { id: v.id, name: v.name, email: v.email }].sort((a, b) => a.name.localeCompare(b.name)));
          setVendorId(String(v.id));
        }}
      />
    </div>
  );
}
