"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronUp, Copy, History, Loader2, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, MoneyInput, Select, Textarea } from "@/components/ui/input";
import { CustomerPicker, type PickedCustomer } from "@/components/customer-picker";
import { priceQuoteItem, saveQuote, similarJobs, type QuotePayload } from "@/app/(app)/quotes/actions";
import { centsToInput, fmtDate, fmtSize, jobNo, money, parseMoney, pct } from "@/lib/format";
import type { PricingResult, FinishingOption } from "@/lib/pricing/engine";
import type { SimilarJob } from "@/lib/pricing/history";
import { cn } from "@/lib/utils";

export type BuilderCategory = { id: number; name: string; method: string; finishing: Pick<FinishingOption, "key" | "label" | "basis" | "priceCents">[]; defaultNeedsInstall: boolean; defaultLocationId: number | null; notes: string | null };
export type BuilderMaterial = { id: number; name: string; unit: string; kind: string };
type Opt = { id: number; name: string };

type Line = {
  key: string;
  categoryId: number | null;
  description: string;
  quantity: string;
  unit: "in" | "ft";
  width: string;
  height: string;
  materialId: number | null;
  material: string;
  finishingKeys: string[];
  finishingExtra: string;
  colors: string;
  specs: string;
  designHours: string;
  installHours: string;
  miles: string;
  outsourced: string;
  customBase: string;
  price: string;
  priceTouched: boolean;
  overrideReason: string;
  taxable: boolean;
  showMore: boolean;
};

export type BuilderInitial = {
  id: number | null;
  customer: PickedCustomer | null;
  contactId: number | null;
  title: string;
  salespersonId: number | null;
  locationId: number | null;
  needsDesign: boolean;
  needsInstall: boolean;
  isRush: boolean;
  dueDate: string | null;
  validUntil: string | null;
  internalNotes: string | null;
  customerNotes: string | null;
  items: {
    categoryId: number | null;
    description: string;
    quantity: number;
    widthIn: number | null;
    heightIn: number | null;
    materialId: number | null;
    material: string | null;
    finishing: string | null;
    colors: string | null;
    specs: string | null;
    pricingInput: Record<string, unknown> | null;
    priceCents: number;
    recommendedCents: number;
    overrideReason: string | null;
    taxable: boolean;
  }[];
};

let seq = 0;
const newKey = () => `l${++seq}`;
const n = (s: string) => {
  const v = Number(String(s).replace(/,/g, ""));
  return s.trim() === "" || !Number.isFinite(v) ? null : v;
};
const toIn = (s: string, unit: "in" | "ft") => {
  const v = n(s);
  return v == null ? null : unit === "ft" ? v * 12 : v;
};

function blankLine(categoryId: number | null = null): Line {
  return { key: newKey(), categoryId, description: "", quantity: "1", unit: "ft", width: "", height: "", materialId: null, material: "", finishingKeys: [], finishingExtra: "", colors: "", specs: "", designHours: "", installHours: "", miles: "", outsourced: "", customBase: "", price: "", priceTouched: false, overrideReason: "", taxable: true, showMore: false };
}

function fromInitial(i: BuilderInitial["items"][number], cats: BuilderCategory[]): Line {
  const pi = (i.pricingInput ?? {}) as Record<string, unknown>;
  const feet = !!i.widthIn && !!i.heightIn && i.widthIn % 12 === 0 && i.heightIn % 12 === 0 && i.widthIn >= 24;
  const keys = (pi.finishingKeys as string[] | undefined) ?? [];
  const cat = cats.find((c) => c.id === i.categoryId);
  const labels = new Set(keys.map((k) => cat?.finishing.find((f) => f.key === k)?.label).filter(Boolean));
  const extra = (i.finishing ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !labels.has(s))
    .join(", ");
  const num = (k: string) => (pi[k] != null ? String(pi[k]) : "");
  return {
    ...blankLine(i.categoryId),
    description: i.description,
    quantity: String(i.quantity),
    unit: feet ? "ft" : "in",
    width: i.widthIn ? String(feet ? i.widthIn / 12 : i.widthIn) : "",
    height: i.heightIn ? String(feet ? i.heightIn / 12 : i.heightIn) : "",
    materialId: i.materialId,
    material: i.material ?? "",
    finishingKeys: keys,
    finishingExtra: extra,
    colors: i.colors ?? "",
    specs: i.specs ?? "",
    designHours: num("designHours"),
    installHours: num("installHours"),
    miles: num("miles"),
    outsourced: pi.outsourcedCostCents != null ? centsToInput(pi.outsourcedCostCents as number) : "",
    customBase: pi.customBaseCents != null ? centsToInput(pi.customBaseCents as number) : "",
    price: centsToInput(i.priceCents),
    priceTouched: i.priceCents !== i.recommendedCents,
    overrideReason: i.overrideReason ?? "",
    taxable: i.taxable,
  };
}

export function QuoteBuilder({
  initial,
  categories,
  materials,
  salespeople,
  locations,
  canSeeCost,
  taxRate,
  currentUserId,
}: {
  initial: BuilderInitial;
  categories: BuilderCategory[];
  materials: BuilderMaterial[];
  salespeople: Opt[];
  locations: Opt[];
  canSeeCost: boolean;
  taxRate: number;
  currentUserId: number;
}) {
  const router = useRouter();
  const [customer, setCustomer] = useState<PickedCustomer | null>(initial.customer);
  const [contactId, setContactId] = useState<number | null>(initial.contactId);
  const [title, setTitle] = useState(initial.title);
  const [salespersonId, setSalespersonId] = useState<number | null>(initial.salespersonId ?? currentUserId);
  const [locationId, setLocationId] = useState<number | null>(initial.locationId);
  const [needsDesign, setNeedsDesign] = useState(initial.needsDesign);
  const [needsInstall, setNeedsInstall] = useState(initial.needsInstall);
  const [isRush, setIsRush] = useState(initial.isRush);
  const [dueDate, setDueDate] = useState(initial.dueDate ?? "");
  const [internalNotes, setInternalNotes] = useState(initial.internalNotes ?? "");
  const [customerNotes, setCustomerNotes] = useState(initial.customerNotes ?? "");
  const [lines, setLines] = useState<Line[]>(() => (initial.items.length ? initial.items.map((i) => fromInitial(i, categories)) : [blankLine()]));
  const [results, setResults] = useState<Record<string, PricingResult | undefined>>({});
  const [pricing, setPricing] = useState<Record<string, boolean>>({});
  const [focus, setFocus] = useState<string>(lines[0]!.key);
  const [saving, startSave] = useTransition();

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // When a customer is picked, default the contact + salesperson.
  const pickCustomer = (c: PickedCustomer | null) => {
    setCustomer(c);
    setContactId(c?.contacts.find((x) => x.isPrimary)?.id ?? c?.contacts[0]?.id ?? null);
    if (c?.salespersonId) setSalespersonId(c.salespersonId);
  };

  // ---------------- live pricing (server-side, debounced per line) ----------------
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const reqIds = useRef<Record<string, number>>({});
  const priceLine = useCallback(
    (l: Line, idx: number) => {
      clearTimeout(timers.current[l.key]);
      timers.current[l.key] = setTimeout(async () => {
        const id = (reqIds.current[l.key] ?? 0) + 1;
        reqIds.current[l.key] = id;
        setPricing((p) => ({ ...p, [l.key]: true }));
        const r = await priceQuoteItem({
          categoryId: l.categoryId,
          quantity: Math.max(0, Math.round(n(l.quantity) ?? 0)),
          widthIn: toIn(l.width, l.unit),
          heightIn: toIn(l.height, l.unit),
          materialId: l.materialId,
          finishingKeys: l.finishingKeys,
          needsDesign: needsDesign && idx === 0,
          designHours: n(l.designHours),
          needsInstall: needsInstall && idx === 0,
          installHours: n(l.installHours),
          miles: n(l.miles),
          outsourcedCostCents: parseMoney(l.outsourced),
          isRush,
          customBaseCents: parseMoney(l.customBase),
          customerId: customer?.id ?? null,
        });
        if (reqIds.current[l.key] !== id) return;
        setPricing((p) => ({ ...p, [l.key]: false }));
        if (!r.ok) return;
        setResults((rs) => ({ ...rs, [l.key]: r.data }));
        if (!l.priceTouched && r.data) setLines((ls) => ls.map((x) => (x.key === l.key && !x.priceTouched ? { ...x, price: centsToInput(r.data!.recommendedCents) } : x)));
      }, 250);
    },
    [needsDesign, needsInstall, isRush, customer?.id],
  );

  const pricingSig = lines.map((l) => [l.categoryId, l.quantity, l.width, l.height, l.unit, l.materialId, l.finishingKeys.join(), l.designHours, l.installHours, l.miles, l.outsourced, l.customBase].join("|")).join("~");
  useEffect(() => {
    lines.forEach((l, i) => priceLine(l, i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricingSig, needsDesign, needsInstall, isRush, customer?.id]);

  // ---------------- similar past jobs for the focused line ----------------
  const focused = lines.find((l) => l.key === focus) ?? lines[0]!;
  const [similar, setSimilar] = useState<{ jobs: SimilarJob[]; stats: { count: number; avgCents: number; minCents: number; maxCents: number } | null } | null>(null);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const simSig = [focused.categoryId, focused.width, focused.height, focused.unit, focused.quantity, focused.description].join("|");
  useEffect(() => {
    if (!focused.categoryId && focused.description.trim().length < 3) {
      setSimilar(null);
      return;
    }
    setLoadingSimilar(true);
    const t = setTimeout(async () => {
      const r = await similarJobs({
        categoryId: focused.categoryId,
        widthIn: toIn(focused.width, focused.unit),
        heightIn: toIn(focused.height, focused.unit),
        quantity: n(focused.quantity),
        text: focused.description || null,
        customerId: customer?.id ?? null,
      });
      setLoadingSimilar(false);
      if (r.ok && r.data) setSimilar(r.data);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simSig, customer?.id]);

  // ---------------- totals ----------------
  const subtotal = lines.reduce((a, l) => a + (parseMoney(l.price) ?? 0), 0);
  const taxable = lines.filter((l) => l.taxable).reduce((a, l) => a + (parseMoney(l.price) ?? 0), 0);
  const tax = customer?.taxExempt ? 0 : Math.round(taxable * taxRate);
  const cost = lines.reduce((a, l) => a + (results[l.key]?.estimatedCostCents ?? 0), 0);

  const autoTitle = useMemo(() => {
    const l = lines[0];
    if (!l) return "";
    const size = fmtSize(toIn(l.width, l.unit), toIn(l.height, l.unit));
    const cat = categories.find((c) => c.id === l.categoryId)?.name;
    return l.description || [size, cat].filter(Boolean).join(" ");
  }, [lines, categories]);

  function payload(): QuotePayload | null {
    if (!customer) {
      toast.error("Choose a customer first.");
      return null;
    }
    return {
      id: initial.id,
      customerId: customer.id,
      contactId,
      title: title.trim() || autoTitle || "Quote",
      salespersonId,
      locationId,
      needsDesign,
      needsInstall,
      isRush,
      dueDate: dueDate || null,
      validUntil: initial.validUntil,
      internalNotes: internalNotes || null,
      customerNotes: customerNotes || null,
      items: lines.map((l) => {
        const cat = categories.find((c) => c.id === l.categoryId);
        const labels = l.finishingKeys.map((k) => cat?.finishing.find((f) => f.key === k)?.label).filter(Boolean) as string[];
        return {
          categoryId: l.categoryId,
          description: l.description.trim() || cat?.name || "Custom item",
          quantity: Math.max(1, Math.round(n(l.quantity) ?? 1)),
          widthIn: toIn(l.width, l.unit),
          heightIn: toIn(l.height, l.unit),
          materialId: l.materialId,
          material: l.material || materials.find((m) => m.id === l.materialId)?.name || null,
          finishing: [...labels, l.finishingExtra.trim()].filter(Boolean).join(", ") || null,
          finishingKeys: l.finishingKeys,
          colors: l.colors || null,
          specs: l.specs || null,
          designHours: n(l.designHours),
          installHours: n(l.installHours),
          miles: n(l.miles),
          outsourcedCostCents: parseMoney(l.outsourced),
          customBaseCents: parseMoney(l.customBase),
          priceCents: parseMoney(l.price) ?? 0,
          overrideReason: l.overrideReason || null,
          taxable: l.taxable,
        };
      }),
    };
  }

  const save = () => {
    const p = payload();
    if (!p) return;
    startSave(async () => {
      const r = await saveQuote(p);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Quote saved");
      router.push(`/quotes/${r.data!.id}`);
      router.refresh();
    });
  };

  const selectedCustomer = customer;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-5">
        {/* ---------- Basics ---------- */}
        <Card>
          <CardHeader title="Customer & job" />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <CustomerPicker value={selectedCustomer} onChange={pickCustomer} autoFocus={!initial.customer} />
            </div>
            {customer && customer.contacts.length > 0 && (
              <Field label="Contact">
                <Select value={contactId ?? ""} onChange={(e) => setContactId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">—</option>
                  {customer.contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Quote title" className={customer?.contacts.length ? "" : "sm:col-span-2"} hint="Short name everyone will recognize">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle || "e.g. ABC Plumbing Ford Transit Wrap"} />
            </Field>
            <Field label="Needed by">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field label="Salesperson">
              <Select value={salespersonId ?? ""} onChange={(e) => setSalespersonId(e.target.value ? Number(e.target.value) : null)}>
                {salespeople.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-wrap gap-x-6 gap-y-3 sm:col-span-2">
              <Checkbox label="Design required" checked={needsDesign} onChange={(e) => setNeedsDesign(e.target.checked)} />
              <Checkbox label="Installation required" checked={needsInstall} onChange={(e) => setNeedsInstall(e.target.checked)} />
              <Checkbox label={<span className="font-medium text-orange-700">Rush</span>} checked={isRush} onChange={(e) => setIsRush(e.target.checked)} />
            </div>
          </CardBody>
        </Card>

        {/* ---------- Lines ---------- */}
        {lines.map((l, idx) => {
          const cat = categories.find((c) => c.id === l.categoryId);
          const r = results[l.key];
          const rec = r?.recommendedCents ?? 0;
          const final = parseMoney(l.price) ?? 0;
          const overridden = l.priceTouched && final !== rec && rec > 0;
          const margin = final > 0 && r && r.estimatedCostCents > 0 ? (final - r.estimatedCostCents) / final : null;
          const sized = cat?.method === "per_sqft" || !!l.width || !!l.height;
          return (
            <Card key={l.key} className={cn(focus === l.key && lines.length > 1 && "ring-2 ring-brand-200")} onFocusCapture={() => setFocus(l.key)} onClick={() => setFocus(l.key)}>
              <CardHeader
                title={lines.length > 1 ? `Line ${idx + 1}` : "What are we making?"}
                action={
                  lines.length > 1 ? (
                    <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove line">
                      <Trash2 className="size-4" />
                    </button>
                  ) : undefined
                }
              />
              <CardBody className="space-y-4">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                  <Field label="Product / job type" className="col-span-2 sm:col-span-3">
                    <Select
                      value={l.categoryId ?? ""}
                      onChange={(e) => {
                        const id = e.target.value ? Number(e.target.value) : null;
                        const c = categories.find((x) => x.id === id);
                        update(l.key, { categoryId: id, finishingKeys: [], unit: c?.method === "per_sqft" && !["posters", "decals"].includes(c.name.toLowerCase()) ? "ft" : "in" });
                        if (c?.defaultNeedsInstall && idx === 0) setNeedsInstall(true);
                        if (c?.defaultLocationId && !locationId) setLocationId(c.defaultLocationId);
                      }}
                    >
                      <option value="">Choose…</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Quantity" className="sm:col-span-1">
                    <Input inputMode="numeric" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
                  </Field>
                  {sized && (
                    <div className="col-span-2 sm:col-span-2">
                      <label className="mb-1.5 flex items-center justify-between text-sm font-medium text-slate-700">
                        Size (W × H)
                        <span className="inline-flex rounded-md border border-slate-200 p-0.5 text-xs">
                          {(["ft", "in"] as const).map((u) => (
                            <button
                              key={u}
                              type="button"
                              onClick={() => {
                                if (u === l.unit) return;
                                const conv = (s: string) => {
                                  const v = n(s);
                                  return v == null ? s : String(Number((u === "in" ? v * 12 : v / 12).toFixed(3)));
                                };
                                update(l.key, { unit: u, width: conv(l.width), height: conv(l.height) });
                              }}
                              className={cn("rounded px-1.5", l.unit === u ? "bg-slate-800 text-white" : "text-slate-500")}
                            >
                              {u}
                            </button>
                          ))}
                        </span>
                      </label>
                      <div className="flex items-center gap-1.5">
                        <Input inputMode="decimal" value={l.width} onChange={(e) => update(l.key, { width: e.target.value })} placeholder="W" />
                        <span className="text-slate-400">×</span>
                        <Input inputMode="decimal" value={l.height} onChange={(e) => update(l.key, { height: e.target.value })} placeholder="H" />
                      </div>
                    </div>
                  )}
                </div>
                <Field label="Description">
                  <Input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} placeholder={cat ? `e.g. ${exampleFor(cat.name)}` : "Describe the item"} />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Material">
                    <Select
                      value={l.materialId ?? (l.material ? "other" : "")}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "other" || v === "") update(l.key, { materialId: null, material: v === "" ? "" : l.material });
                        else update(l.key, { materialId: Number(v), material: materials.find((m) => m.id === Number(v))?.name ?? "" });
                      }}
                    >
                      <option value="">Standard / not sure</option>
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                      <option value="other">Other (type it)</option>
                    </Select>
                    {l.materialId == null && (l.material || false) !== false && <Input className="mt-2" value={l.material} onChange={(e) => update(l.key, { material: e.target.value })} placeholder="Material" />}
                  </Field>
                  <Field label="Finishing & notes">
                    <Input value={l.finishingExtra} onChange={(e) => update(l.key, { finishingExtra: e.target.value })} placeholder="e.g. laminate, H-stakes, trim to size" />
                  </Field>
                </div>
                {cat && cat.finishing.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {cat.finishing.map((f) => {
                      const on = l.finishingKeys.includes(f.key);
                      return (
                        <button
                          type="button"
                          key={f.key}
                          onClick={() => update(l.key, { finishingKeys: on ? l.finishingKeys.filter((k) => k !== f.key) : [...l.finishingKeys, f.key] })}
                          className={cn("rounded-full border px-3 py-1.5 text-sm font-medium", on ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}
                        >
                          {on ? "✓ " : "+ "}
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {cat?.method === "custom" && (
                  <Field label="Base price (custom job)" hint="Custom work isn't priced by formula — enter your base and the rest (design, install, rush) is added.">
                    <MoneyInput value={l.customBase} onChange={(e) => update(l.key, { customBase: e.target.value })} className="max-w-48" />
                  </Field>
                )}

                <button type="button" onClick={() => update(l.key, { showMore: !l.showMore })} className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
                  {l.showMore ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />} More options (colors, specs, hours, outside costs)
                </button>
                {l.showMore && (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Field label="Colors">
                      <Input value={l.colors} onChange={(e) => update(l.key, { colors: e.target.value })} placeholder="4/4, PMS 286" />
                    </Field>
                    {idx === 0 && needsDesign && (
                      <Field label="Design hours">
                        <Input inputMode="decimal" value={l.designHours} onChange={(e) => update(l.key, { designHours: e.target.value })} placeholder="default" />
                      </Field>
                    )}
                    {idx === 0 && needsInstall && (
                      <>
                        <Field label="Install hours">
                          <Input inputMode="decimal" value={l.installHours} onChange={(e) => update(l.key, { installHours: e.target.value })} placeholder="default" />
                        </Field>
                        <Field label="Travel miles">
                          <Input inputMode="decimal" value={l.miles} onChange={(e) => update(l.key, { miles: e.target.value })} />
                        </Field>
                      </>
                    )}
                    <Field label="Outside vendor cost">
                      <MoneyInput value={l.outsourced} onChange={(e) => update(l.key, { outsourced: e.target.value })} />
                    </Field>
                    <Field label="Specifications" className="col-span-2 sm:col-span-4">
                      <Textarea rows={2} value={l.specs} onChange={(e) => update(l.key, { specs: e.target.value })} placeholder="Vehicle year/make/model, paper stock, bleed, etc." />
                    </Field>
                    <Checkbox label="Taxable" checked={l.taxable} onChange={(e) => update(l.key, { taxable: e.target.checked })} />
                  </div>
                )}

                {/* ---- price ---- */}
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="flex flex-wrap items-end gap-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Recommended</p>
                      <p className="tabular flex items-center gap-2 text-2xl font-semibold text-slate-700">
                        {pricing[l.key] && !r ? <Loader2 className="size-5 animate-spin text-slate-400" /> : money(rec)}
                        {pricing[l.key] && r && <Loader2 className="size-4 animate-spin text-slate-300" />}
                      </p>
                    </div>
                    <div className="w-44">
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Final price</p>
                      <MoneyInput
                        value={l.price}
                        onChange={(e) => update(l.key, { price: e.target.value, priceTouched: true })}
                        className={cn("h-11 text-lg font-semibold", overridden && "border-amber-400 bg-amber-50")}
                      />
                    </div>
                    {overridden && (
                      <Button size="sm" variant="ghost" onClick={() => update(l.key, { price: centsToInput(rec), priceTouched: false, overrideReason: "" })}>
                        <Wand2 className="size-4" /> Use recommended
                      </Button>
                    )}
                    {canSeeCost && r && r.estimatedCostCents > 0 && (
                      <div className="ml-auto text-right text-sm">
                        <p className="text-slate-500">
                          Est. cost <span className="tabular font-medium text-slate-700">{money(r.estimatedCostCents)}</span>
                        </p>
                        <p className={cn("font-semibold", margin != null && margin < r.targetMarginPct ? "text-red-600" : "text-emerald-700")}>Margin {pct(margin)}</p>
                      </div>
                    )}
                  </div>
                  {overridden && (
                    <Input className="mt-3" value={l.overrideReason} onChange={(e) => update(l.key, { overrideReason: e.target.value })} placeholder="Why the different price? (optional — e.g. repeat customer, matched last order)" />
                  )}
                  {r && r.lines.length > 0 && (
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-800">How we got {money(rec)}</summary>
                      <dl className="tabular mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                        {r.lines.map((b, i) => (
                          <div key={i} className="contents">
                            <dt className="text-slate-600">
                              {b.label}
                              {b.detail && <span className="text-slate-400"> · {b.detail}</span>}
                            </dt>
                            <dd className="text-right text-slate-800">{money(b.cents)}</dd>
                          </div>
                        ))}
                      </dl>
                      {canSeeCost && r.costLines.length > 0 && (
                        <dl className="tabular mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-slate-200 pt-2 text-xs text-slate-500">
                          {r.costLines.map((b, i) => (
                            <div key={i} className="contents">
                              <dt>
                                Cost: {b.label}
                                {b.detail && ` · ${b.detail}`}
                              </dt>
                              <dd className="text-right">{money(b.cents)}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </details>
                  )}
                  {r?.warnings.map((w) => (
                    <p key={w} className="mt-2 flex items-start gap-1.5 text-sm text-amber-700">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {w}
                    </p>
                  ))}
                  {cat?.notes && <p className="mt-2 text-xs text-slate-500">📘 {cat.notes}</p>}
                </div>
              </CardBody>
            </Card>
          );
        })}

        <div className="flex gap-2">
          <Button
            onClick={() => {
              const l = blankLine(lines[lines.length - 1]?.categoryId ?? null);
              setLines((ls) => [...ls, l]);
              setFocus(l.key);
            }}
          >
            <Plus className="size-4" /> Add another line
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              const src = lines.find((x) => x.key === focus) ?? lines[lines.length - 1]!;
              const l = { ...src, key: newKey() };
              setLines((ls) => [...ls, l]);
              setFocus(l.key);
            }}
          >
            <Copy className="size-4" /> Duplicate line
          </Button>
        </div>

        {/* ---------- Totals & notes ---------- */}
        <Card>
          <CardBody className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="space-y-4">
              <Field label="Notes for the customer" hint="Included when the quote is emailed">
                <Textarea rows={3} value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} placeholder="Price includes one round of revisions…" />
              </Field>
              <Field label="Internal notes (staff only)">
                <Textarea rows={3} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-col justify-between gap-4">
              <dl className="tabular grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-right text-[15px]">
                <dt className="text-slate-500">Subtotal</dt>
                <dd className="font-medium">{money(subtotal)}</dd>
                <dt className="text-slate-500">{customer?.taxExempt ? "Tax (exempt)" : `Sales tax ${(taxRate * 100).toFixed(2).replace(/\.?0+$/, "")}%`}</dt>
                <dd className="font-medium">{money(tax)}</dd>
                <dt className="text-lg font-semibold text-slate-900">Total</dt>
                <dd className="text-lg font-semibold text-slate-900">{money(subtotal + tax)}</dd>
                {canSeeCost && cost > 0 && subtotal > 0 && (
                  <>
                    <dt className="text-sm text-slate-500">Estimated margin</dt>
                    <dd className="text-sm font-medium text-slate-700">{pct((subtotal - cost) / subtotal)}</dd>
                  </>
                )}
              </dl>
              <div className="flex flex-wrap justify-end gap-2">
                {initial.id && (
                  <Link href={`/quotes/${initial.id}`} className="inline-flex h-12 items-center px-4 text-[15px] font-medium text-slate-600 hover:text-slate-900">
                    Cancel
                  </Link>
                )}
                <Button variant="primary" size="lg" onClick={save} disabled={saving}>
                  {saving && <Loader2 className="size-4 animate-spin" />} Save quote
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* ---------- Similar past jobs ---------- */}
      <aside className="xl:sticky xl:top-20 xl:self-start">
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <History className="size-4 text-brand-500" /> Similar past jobs
              </span>
            }
            description={lines.length > 1 ? `For line ${lines.findIndex((x) => x.key === focused.key) + 1}` : "What we charged before"}
          />
          <CardBody>
            {!similar && !loadingSimilar && <p className="text-sm text-slate-500">Choose a product and size to see what we charged for similar work.</p>}
            {loadingSimilar && !similar && <p className="text-sm text-slate-500">Looking up past jobs…</p>}
            {similar && (
              <>
                {similar.stats ? (
                  <div className="mb-4 rounded-xl bg-brand-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-brand-700">Historical average ({similar.stats.count} close matches)</p>
                    <p className="tabular mt-1 text-2xl font-semibold text-brand-800">{money(similar.stats.avgCents)}</p>
                    <p className="tabular text-sm text-brand-700">
                      Range {money(similar.stats.minCents)} – {money(similar.stats.maxCents)}
                    </p>
                    <Button
                      size="sm"
                      className="mt-2"
                      onClick={() => {
                        update(focused.key, { price: centsToInput(similar.stats!.avgCents), priceTouched: true, overrideReason: "Matched historical average" });
                      }}
                    >
                      <Sparkles className="size-4" /> Use average
                    </Button>
                  </div>
                ) : (
                  similar.jobs.length > 0 && <p className="mb-3 text-sm text-slate-500">No close matches — here are the nearest jobs.</p>
                )}
                {similar.jobs.length === 0 ? (
                  <p className="text-sm text-slate-500">We haven&apos;t done anything like this before (or it&apos;s not in the system yet).</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {similar.jobs.map((j) => (
                      <li key={`${j.jobId}-${j.description}`} className="py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link href={`/jobs/${j.number}`} target="_blank" className="block truncate text-sm font-medium text-slate-800 hover:text-brand-700 hover:underline">
                              {j.title}
                            </Link>
                            <p className="truncate text-xs text-slate-500">
                              {[j.quantity > 1 ? `${j.quantity.toLocaleString()} pcs` : null, fmtSize(j.widthIn, j.heightIn), j.material].filter(Boolean).join(" · ")}
                            </p>
                            <p className="text-xs text-slate-400">
                              {j.customer} · {fmtDate(j.date, { year: true, weekday: false })} · {jobNo(j.number)}
                            </p>
                          </div>
                          <button
                            type="button"
                            title="Use this price"
                            onClick={() => update(focused.key, { price: centsToInput(j.priceCents), priceTouched: true, overrideReason: `Matched ${jobNo(j.number)}` })}
                            className={cn("tabular shrink-0 rounded-md px-2 py-1 text-sm font-semibold hover:bg-brand-50 hover:text-brand-700", j.close ? "text-slate-900" : "text-slate-500")}
                          >
                            {money(j.priceCents)}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <Link href={`/quotes/lookup?${new URLSearchParams({ q: [focused.width && focused.height ? `${focused.width}x${focused.height}${focused.unit === "in" ? "in" : ""}` : "", focused.description || categories.find((c) => c.id === focused.categoryId)?.name || ""].join(" ").trim() })}`} target="_blank" className="mt-3 block text-sm font-medium text-brand-600 hover:underline">
                  Search all past prices →
                </Link>
              </>
            )}
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}

function exampleFor(cat: string) {
  const c = cat.toLowerCase();
  if (c.includes("banner stand")) return "33×81 retractable banner stand with print";
  if (c.includes("banner")) return "Outdoor banner, full color";
  if (c.includes("business")) return "Business cards, 14pt, double-sided";
  if (c.includes("brochure")) return "Tri-fold brochures, 100# gloss";
  if (c.includes("wrap")) return "Ford Transit 148\" high roof — full wrap";
  if (c.includes("vehicle")) return "Door logos + rear window graphics";
  if (c.includes("yard")) return "Yard signs 18×24, double-sided with stakes";
  if (c.includes("sign")) return "Aluminum sign with drilled holes";
  if (c.includes("wall")) return "Lobby wall mural, installed";
  return cat;
}
