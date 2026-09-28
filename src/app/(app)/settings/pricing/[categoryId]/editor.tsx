"use client";
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Calculator, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  calculatePrice,
  type BusinessRules,
  type FinishingOption,
  type PricingConfig,
  type PricingMethod,
} from "@/lib/pricing/engine";
import type { PrintCatalog, PrintConfig } from "@/lib/pricing/print";
import { BASIS_LABELS, GROUP_LABELS, PRICING_METHOD_HINTS, PRICING_METHOD_LABELS, slugify } from "@/lib/admin/pricing-labels";
import { centsToInput, fmtSize, money, parseMoney, pct } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, MoneyInput, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SuffixInput } from "../../_components/inputs";
import { savePricingRule } from "../actions";

type Loc = { id: number; name: string };
/** Category print settings as saved. */
type SavedPrintConfig = PrintConfig;
type PrintForm = {
  paperMode: "all" | "some";
  paperIds: number[];
  defaultPaperId: string;
  pressMode: "all" | "some";
  pressIds: number[];
  opIds: number[];
  sides: "1" | "2" | "multi";
  pageCount: string;
  colorsFront: string;
  colorsBack: string;
  bleedIn: string;
  defaultBleed: boolean;
  gutterIn: string;
  paperMarkupPct: string;
};
type Mat = { id: number; name: string; unit: string; costCents: number };
type CategoryFields = {
  name: string;
  group: string;
  defaultLocationId: number | null;
  defaultNeedsProof: boolean;
  defaultNeedsInstall: boolean;
  active: boolean;
};

type TierRow = { id: number; minQty: string; price: string; cost: string };
type OptRow = { id: number; key: string; isNew: boolean; label: string; basis: FinishingOption["basis"]; price: string; cost: string };
type Form = {
  method: PricingMethod;
  pricePerSqft: string;
  materialCostPerSqft: string;
  materialMarkupPct: string;
  unitPrice: string;
  unitCost: string;
  tiers: TierRow[];
  setup: string;
  wastePct: string;
  machineHours: string;
  machineCostPerHour: string;
  designHours: string;
  installHours: string;
  minimum: string;
  targetMarginPct: string;
  rushPct: string;
  options: OptRow[];
  print: PrintForm;
};

let rowId = 1;
const nextId = () => rowId++;
const m = (c: number | undefined) => (c == null ? "" : centsToInput(c));
const p = (v: number | undefined) => (v == null ? "" : String(Math.round(v * 10000) / 100));
const n = (v: number | undefined) => (v == null ? "" : String(v));

function toForm(c: PricingConfig): Form {
  return {
    method: c.method,
    pricePerSqft: m(c.pricePerSqftCents),
    materialCostPerSqft: m(c.materialCostPerSqftCents),
    materialMarkupPct: p(c.materialMarkupPct),
    unitPrice: m(c.unitPriceCents),
    unitCost: m(c.unitCostCents),
    tiers: [...(c.tiers ?? [])]
      .sort((a, b) => a.minQty - b.minQty)
      .map((t) => ({ id: nextId(), minQty: String(t.minQty), price: m(t.priceCents), cost: m(t.costCents) })),
    setup: m(c.setupCents),
    wastePct: p(c.wastePct),
    machineHours: n(c.machineHours),
    machineCostPerHour: m(c.machineCostPerHourCents),
    designHours: n(c.designHours),
    installHours: n(c.installHours),
    minimum: m(c.minimumCents),
    targetMarginPct: p(c.targetMarginPct),
    rushPct: p(c.rushPct),
    print: toPrintForm(c.print),
    options: (c.finishingOptions ?? []).map((o) => ({
      id: nextId(),
      key: o.key,
      isNew: false,
      label: o.label,
      basis: o.basis,
      price: m(o.priceCents),
      cost: m(o.costCents),
    })),
  };
}

function toPrintForm(pc: SavedPrintConfig | undefined): PrintForm {
  const c = pc ?? {};
  const pages = c.defaultPages ?? 1;
  return {
    paperMode: c.paperIds?.length ? "some" : "all",
    paperIds: c.paperIds ?? [],
    defaultPaperId: c.defaultPaperId ? String(c.defaultPaperId) : "",
    pressMode: c.pressIds?.length ? "some" : "all",
    pressIds: c.pressIds ?? [],
    opIds: c.defaultOperationIds ?? [],
    sides: pages > 2 ? "multi" : pages === 2 ? "2" : "1",
    pageCount: pages > 2 ? String(pages) : "8",
    colorsFront: String(c.defaultColorsFront ?? 4),
    colorsBack: String(c.defaultColorsBack ?? (pages === 2 ? 4 : 0)),
    bleedIn: n(c.bleedIn ?? 0.125),
    defaultBleed: c.defaultBleed ?? false,
    gutterIn: n(c.gutterIn),
    paperMarkupPct: p(c.paperMarkupPct ?? 0.3),
  };
}

/** Turn the form into a PricingConfig, collecting plain-English problems along the way. */
function toConfig(f: Form): { config: PricingConfig; errors: string[] } {
  const errors: string[] = [];
  const money$ = (s: string, label: string) => {
    if (s.trim() === "") return undefined;
    const c = parseMoney(s);
    if (c == null || c < 0) {
      errors.push(`${label} must be a dollar amount.`);
      return undefined;
    }
    return c;
  };
  const pct$ = (s: string, label: string) => {
    if (s.trim() === "") return undefined;
    const v = Number(s.replace(/[%,\s]/g, ""));
    if (!Number.isFinite(v) || v < 0) {
      errors.push(`${label} must be a percentage.`);
      return undefined;
    }
    return Math.round(v * 100) / 10000;
  };
  const num$ = (s: string, label: string) => {
    if (s.trim() === "") return undefined;
    const v = Number(s.replace(/,/g, ""));
    if (!Number.isFinite(v) || v < 0) {
      errors.push(`${label} must be a number.`);
      return undefined;
    }
    return v;
  };

  const config: PricingConfig = { method: f.method };
  const set = <K extends keyof PricingConfig>(k: K, v: PricingConfig[K] | undefined) => {
    if (v !== undefined) config[k] = v;
  };
  if (f.method === "per_sqft") {
    set("pricePerSqftCents", money$(f.pricePerSqft, "Price per sq ft"));
    set("materialCostPerSqftCents", money$(f.materialCostPerSqft, "Material cost per sq ft"));
    set("materialMarkupPct", pct$(f.materialMarkupPct, "Material markup"));
  }
  if (f.method === "per_unit") {
    set("unitPriceCents", money$(f.unitPrice, "Price each"));
    set("unitCostCents", money$(f.unitCost, "Our cost each"));
  }
  if (f.method === "sheet_fed") {
    const pf = f.print;
    const pc: SavedPrintConfig = {};
    if (pf.paperMode === "some") {
      if (!pf.paperIds.length) errors.push("Pick at least one paper, or choose “All paper stocks”.");
      else pc.paperIds = pf.paperIds;
    }
    if (pf.defaultPaperId) {
      const id = Number(pf.defaultPaperId);
      if (pc.paperIds && !pc.paperIds.includes(id)) errors.push("The usual paper must be one of the papers you picked.");
      pc.defaultPaperId = id;
    }
    if (pf.pressMode === "some") {
      if (!pf.pressIds.length) errors.push("Pick at least one press, or choose “All presses”.");
      else pc.pressIds = pf.pressIds;
    }
    if (pf.opIds.length) pc.defaultOperationIds = pf.opIds;
    let pages = pf.sides === "2" ? 2 : 1;
    if (pf.sides === "multi") {
      const count = Number(pf.pageCount);
      if (!Number.isInteger(count) || count < 3 || count > 1000) errors.push("Enter the number of pages (4, 8, 12…).");
      else pages = count;
    }
    pc.defaultPages = pages;
    pc.defaultColorsFront = Number(pf.colorsFront);
    pc.defaultColorsBack = pages === 2 ? Number(pf.colorsBack) : 0;
    const bleed = num$(pf.bleedIn, "Bleed");
    if (bleed != null && bleed > 2) errors.push("Bleed must be under 2 inches.");
    if (bleed != null) pc.bleedIn = bleed;
    if (pf.defaultBleed) pc.defaultBleed = true;
    const gutter = num$(pf.gutterIn, "Space between pieces");
    if (gutter != null && gutter > 5) errors.push("Space between pieces must be under 5 inches.");
    if (gutter) pc.gutterIn = gutter;
    const markup = pct$(pf.paperMarkupPct, "Paper markup");
    if (markup != null) pc.paperMarkupPct = markup;
    config.print = pc;
  }
  if (f.method === "quantity_tier") {
    const tiers = f.tiers
      .filter((t) => t.minQty.trim() || t.price.trim() || t.cost.trim())
      .map((t, i) => {
        const q = Number(t.minQty.replace(/,/g, ""));
        if (!Number.isInteger(q) || q < 1) errors.push(`Tier ${i + 1}: enter a whole-number quantity.`);
        const price = money$(t.price, `Tier ${i + 1} price`);
        if (price === undefined && !t.price.trim()) errors.push(`Tier ${i + 1}: enter a price.`);
        return { minQty: q, priceCents: price ?? 0, costCents: money$(t.cost, `Tier ${i + 1} cost`) };
      });
    const qtys = tiers.map((t) => t.minQty);
    if (new Set(qtys).size !== qtys.length) errors.push("Two tiers have the same quantity.");
    if (tiers.length) config.tiers = tiers.sort((a, b) => a.minQty - b.minQty);
  }
  set("setupCents", money$(f.setup, "Setup fee"));
  // Print estimating works out spoilage and press time itself.
  if (f.method !== "sheet_fed") {
    set("wastePct", pct$(f.wastePct, "Waste"));
    set("machineHours", num$(f.machineHours, "Machine hours"));
    set("machineCostPerHourCents", money$(f.machineCostPerHour, "Machine cost per hour"));
  }
  set("designHours", num$(f.designHours, "Design hours"));
  set("installHours", num$(f.installHours, "Install hours"));
  set("minimumCents", money$(f.minimum, "Minimum charge"));
  const tm = pct$(f.targetMarginPct, "Target margin");
  if (tm != null && tm >= 0.95) errors.push("Target margin must be below 95%.");
  set("targetMarginPct", tm);
  set("rushPct", pct$(f.rushPct, "Rush fee"));

  const used = new Set<string>();
  const options: FinishingOption[] = [];
  f.options.forEach((o, i) => {
    if (!o.label.trim() && !o.price.trim()) return;
    if (!o.label.trim()) errors.push(`Finishing option ${i + 1} needs a name.`);
    let key = o.isNew ? slugify(o.label) || "option" : o.key;
    if (o.isNew) for (let k = 2; used.has(key); k++) key = `${slugify(o.label) || "option"}-${k}`;
    if (used.has(key)) errors.push(`Two finishing options are both called “${o.label}”.`);
    used.add(key);
    const price = money$(o.price, `${o.label || "Finishing option"} price`);
    options.push({ key, label: o.label.trim(), basis: o.basis, priceCents: price ?? 0, costCents: money$(o.cost, `${o.label || "Finishing option"} cost`) });
  });
  if (options.length) config.finishingOptions = options;
  return { config, errors };
}

export function PricingEditor({
  categoryId,
  category: initialCategory,
  config: initialConfig,
  notes: initialNotes,
  rules,
  locations,
  materials,
  catalog,
}: {
  categoryId: number;
  category: CategoryFields;
  config: PricingConfig;
  notes: string;
  rules: BusinessRules;
  locations: Loc[];
  materials: Mat[];
  catalog: PrintCatalog;
}) {
  const [cat, setCat] = React.useState(initialCategory);
  const [form, setForm] = React.useState<Form>(() => toForm(initialConfig));
  const [notes, setNotes] = React.useState(initialNotes);
  const [saved, setSaved] = React.useState(() => JSON.stringify([initialCategory, toConfig(toForm(initialConfig)).config, initialNotes]));
  const [saving, startSave] = React.useTransition();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const { config, errors } = React.useMemo(() => toConfig(form), [form]);
  const dirty = JSON.stringify([cat, config, notes]) !== saved;

  const upd = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const txt = (k: keyof Form) => ({
    value: form[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => upd(k, e.target.value as never),
  });

  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function save() {
    if (errors.length) return;
    setServerError(null);
    startSave(async () => {
      const r = await savePricingRule(categoryId, { category: cat, config, notes: notes || null });
      if (r.ok) {
        setSaved(JSON.stringify([cat, config, notes]));
        toast.success(r.message ?? "Saved");
      } else setServerError(r.error);
    });
  }

  const companyMin = money(rules.minimumChargeCents);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="space-y-5">
        <Card>
          <CardHeader title="About this category" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="c-name" required>
              <Input id="c-name" value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} />
            </Field>
            <Field label="Group" htmlFor="c-group">
              <Select id="c-group" value={cat.group} onChange={(e) => setCat({ ...cat, group: e.target.value })}>
                {Object.entries(GROUP_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Usually made at" htmlFor="c-loc" hint="New jobs in this category start at this location.">
              <Select
                id="c-loc"
                value={cat.defaultLocationId ?? ""}
                onChange={(e) => setCat({ ...cat, defaultLocationId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">—</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="space-y-3 sm:pt-7">
              <Checkbox
                label="Usually needs a proof"
                checked={cat.defaultNeedsProof}
                onChange={(e) => setCat({ ...cat, defaultNeedsProof: e.target.checked })}
              />
              <Checkbox
                label="Usually needs installation"
                checked={cat.defaultNeedsInstall}
                onChange={(e) => setCat({ ...cat, defaultNeedsInstall: e.target.checked })}
              />
              <Checkbox
                label="In use"
                hint="Turn off to hide it from new quotes. Old quotes and jobs keep it."
                checked={cat.active}
                onChange={(e) => setCat({ ...cat, active: e.target.checked })}
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="How it's priced" description={PRICING_METHOD_HINTS[form.method]} />
          <CardBody className="space-y-4">
            <Field label="Pricing method" htmlFor="c-method">
              <Select id="c-method" value={form.method} onChange={(e) => upd("method", e.target.value as PricingMethod)} className="sm:max-w-xs">
                {Object.entries(PRICING_METHOD_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>

            {form.method === "per_sqft" && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Price per sq ft" htmlFor="c-psf" hint="What the customer pays.">
                  <MoneyInput id="c-psf" {...txt("pricePerSqft")} />
                </Field>
                <Field label="Our material cost per sq ft" htmlFor="c-msf" hint="Used when no specific material is picked.">
                  <MoneyInput id="c-msf" {...txt("materialCostPerSqft")} />
                </Field>
                <Field label="Markup on a chosen material" htmlFor="c-mk" hint="If a quote picks a pricier material, charge its cost plus this much.">
                  <SuffixInput id="c-mk" suffix="%" {...txt("materialMarkupPct")} />
                </Field>
              </div>
            )}

            {form.method === "per_unit" && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Price each" htmlFor="c-up">
                  <MoneyInput id="c-up" {...txt("unitPrice")} />
                </Field>
                <Field label="Our cost each" htmlFor="c-uc">
                  <MoneyInput id="c-uc" {...txt("unitCost")} />
                </Field>
              </div>
            )}

            {form.method === "sheet_fed" && <PrintSettings value={form.print} onChange={(v) => upd("print", v)} catalog={catalog} />}

            {form.method === "quantity_tier" && (
              <TiersTable tiers={form.tiers} onChange={(t) => upd("tiers", t)} />
            )}

            {form.method === "custom" && (
              <p className="rounded-lg bg-slate-50 px-4 py-3 text-[15px] text-slate-600">
                The person quoting types in the price for each job. The setup fee, hours, minimum and finishing options below still apply.
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={form.method === "sheet_fed" ? "Setup & time" : "Setup, time & waste"}
            description={form.method === "sheet_fed" ? "Leave a box empty if it doesn't apply. Spoilage and press time come from the press settings." : "Leave a box empty if it doesn't apply."}
          />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Field label="Setup fee" htmlFor="c-setup" hint="Charged once per line.">
              <MoneyInput id="c-setup" {...txt("setup")} />
            </Field>
            <Field label="Design hours (usual)" htmlFor="c-dh" hint={`When design is needed. Charged at ${money(rules.designRateCents)}/hr.`}>
              <SuffixInput id="c-dh" suffix="hr" {...txt("designHours")} />
            </Field>
            <Field label="Install hours (usual)" htmlFor="c-ih" hint={`When install is needed. Charged at ${money(rules.installRateCents)}/hr.`}>
              <SuffixInput id="c-ih" suffix="hr" {...txt("installHours")} />
            </Field>
            {form.method !== "sheet_fed" && (
              <>
                <Field label="Machine time per job" htmlFor="c-mh" hint="Counts toward our cost only.">
                  <SuffixInput id="c-mh" suffix="hr" {...txt("machineHours")} />
                </Field>
                <Field label="Machine cost per hour" htmlFor="c-mc" hint="What running the machine costs us.">
                  <MoneyInput id="c-mc" {...txt("machineCostPerHour")} />
                </Field>
                <Field label="Extra material for waste" htmlFor="c-waste" hint="Adds to our cost only.">
                  <SuffixInput id="c-waste" suffix="%" {...txt("wastePct")} />
                </Field>
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Guard rails" description="Leave empty to use the company-wide business rules." />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Field label="Minimum charge" htmlFor="c-min" hint={`Company rule: ${companyMin}`}>
              <MoneyInput id="c-min" placeholder={centsToInput(rules.minimumChargeCents)} {...txt("minimum")} />
            </Field>
            <Field label="Target margin" htmlFor="c-tm" hint={`Company rule: ${pct(rules.targetMarginPct)}`}>
              <SuffixInput id="c-tm" suffix="%" placeholder={p(rules.targetMarginPct)} {...txt("targetMarginPct")} />
            </Field>
            <Field label="Rush fee" htmlFor="c-rush" hint={`Company rule: +${pct(rules.rushPct)}`}>
              <SuffixInput id="c-rush" suffix="%" placeholder={p(rules.rushPct)} {...txt("rushPct")} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Finishing options"
            description={
              form.method === "sheet_fed"
                ? "Extra charges someone can tick on a quote, like EDDM prep. Cutting, folding and other bindery come from Bindery & Services."
                : "Extras someone can tick on a quote, like grommets, lamination or rounded corners."
            }
          />
          <OptionsTable options={form.options} onChange={(o) => upd("options", o)} />
        </Card>

        <Card>
          <CardHeader title="How we price this" description="In your own words: rules of thumb, what to watch out for, typical prices. Shown to whoever builds a quote." />
          <CardBody>
            <Textarea
              rows={5}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. A 4×8 banner usually lands between $185 and $210. Pole pockets instead of grommets for fences."
              aria-label="How we price this"
            />
          </CardBody>
        </Card>

        <div className="sticky bottom-20 z-10 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-md backdrop-blur lg:bottom-4">
          {(errors.length > 0 || serverError) && (
            <ul className="mb-3 space-y-1 rounded-lg bg-red-50 px-3 py-2 text-[15px] text-red-700" role="alert">
              {serverError && <li>{serverError}</li>}
              {errors.slice(0, 4).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-end gap-3">
            <span className={cn("mr-auto text-sm", dirty ? "font-medium text-amber-700" : "text-slate-500")}>
              {dirty ? "You have unsaved changes" : "All changes saved"}
            </span>
            <Button variant="primary" size="lg" onClick={save} disabled={saving || !dirty || errors.length > 0}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? "Saving…" : "Save pricing"}
            </Button>
          </div>
        </div>
      </div>

      <div className="lg:sticky lg:top-24 lg:self-start">
        {form.method === "sheet_fed" ? (
          <PrintTryIt config={config} rules={rules} catalog={catalog} categoryName={cat.name} />
        ) : (
          <TryIt key={form.method} config={config} rules={rules} materials={materials} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function TiersTable({ tiers, onChange }: { tiers: TierRow[]; onChange: (t: TierRow[]) => void }) {
  const edit = (id: number, patch: Partial<TierRow>) => onChange(tiers.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-[15px]">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Quantity</th>
              <th className="px-3 py-2">Price for all</th>
              <th className="px-3 py-2">Our cost</th>
              <th className="px-3 py-2 text-right">Each</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => {
              const q = Number(t.minQty);
              const price = parseMoney(t.price);
              return (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <Input inputMode="numeric" value={t.minQty} onChange={(e) => edit(t.id, { minQty: e.target.value })} aria-label="Quantity" className="min-w-20 tabular" />
                  </td>
                  <td className="px-3 py-2">
                    <MoneyInput value={t.price} onChange={(e) => edit(t.id, { price: e.target.value })} aria-label="Price" className="min-w-24" />
                  </td>
                  <td className="px-3 py-2">
                    <MoneyInput value={t.cost} onChange={(e) => edit(t.id, { cost: e.target.value })} aria-label="Our cost" className="min-w-24" />
                  </td>
                  <td className="px-3 py-2 text-right text-sm whitespace-nowrap text-slate-500 tabular">
                    {q > 0 && price ? `${money(price / q)}` : "—"}
                  </td>
                  <td className="px-1 py-2">
                    <Button variant="ghost" size="sm" aria-label="Remove tier" onClick={() => onChange(tiers.filter((x) => x.id !== t.id))}>
                      <Trash2 className="size-4 text-slate-500" />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {tiers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                  No quantity tiers yet. Add one for each price break (e.g. 250, 500, 1,000).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" onClick={() => onChange([...tiers, { id: nextId(), minQty: "", price: "", cost: "" }])}>
          <Plus className="size-4" /> Add tier
        </Button>
        <p className="text-sm text-slate-500">Between tiers we charge the per-piece rate of the tier below. Below the smallest tier, we charge the smallest tier.</p>
      </div>
    </div>
  );
}

function OptionsTable({ options, onChange }: { options: OptRow[]; onChange: (o: OptRow[]) => void }) {
  const edit = (id: number, patch: Partial<OptRow>) => onChange(options.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  return (
    <div className="px-5 py-4">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-[15px]">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Charged</th>
              <th className="px-3 py-2">Price</th>
              <th className="px-3 py-2">Our cost</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {options.map((o) => (
              <tr key={o.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <Input value={o.label} onChange={(e) => edit(o.id, { label: e.target.value })} aria-label="Option name" className="min-w-40" placeholder="e.g. Grommets" />
                </td>
                <td className="px-3 py-2">
                  <Select value={o.basis} onChange={(e) => edit(o.id, { basis: e.target.value as OptRow["basis"] })} aria-label="How it's charged" className="min-w-40">
                    {Object.entries(BASIS_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-3 py-2">
                  <MoneyInput value={o.price} onChange={(e) => edit(o.id, { price: e.target.value })} aria-label="Price" className="min-w-24" />
                </td>
                <td className="px-3 py-2">
                  <MoneyInput value={o.cost} onChange={(e) => edit(o.id, { cost: e.target.value })} aria-label="Our cost" className="min-w-24" />
                </td>
                <td className="px-1 py-2">
                  <Button variant="ghost" size="sm" aria-label="Remove option" onClick={() => onChange(options.filter((x) => x.id !== o.id))}>
                    <Trash2 className="size-4 text-slate-500" />
                  </Button>
                </td>
              </tr>
            ))}
            {options.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                  No finishing options for this category.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Button
        size="sm"
        className="mt-2"
        onClick={() => onChange([...options, { id: nextId(), key: "", isNew: true, label: "", basis: "flat", price: "", cost: "" }])}
      >
        <Plus className="size-4" /> Add finishing option
      </Button>
      <p className="mt-2 text-sm text-slate-500">
        <b>Flat</b> is charged once per line. <b>Per linear ft</b> is measured around the edges of each piece (hems, pole pockets).
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
function TryIt({ config, rules, materials }: { config: PricingConfig; rules: BusinessRules; materials: Mat[] }) {
  const firstTier = [...(config.tiers ?? [])].sort((a, b) => a.minQty - b.minQty)[0]?.minQty;
  const [qty, setQty] = React.useState(String(config.method === "quantity_tier" ? (firstTier ?? 250) : config.method === "per_unit" ? 10 : 1));
  const [w, setW] = React.useState("48");
  const [h, setH] = React.useState("96");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [materialId, setMaterialId] = React.useState("");
  const [design, setDesign] = React.useState(false);
  const [install, setInstall] = React.useState(false);
  const [rush, setRush] = React.useState(false);
  const [base, setBase] = React.useState("");

  const sqftMats = materials.filter((mt) => mt.unit === "sqft");
  const mat = sqftMats.find((mt) => String(mt.id) === materialId);
  const needsSize =
    config.method === "per_sqft" || (config.finishingOptions ?? []).some((o) => o.basis === "per_sqft" || o.basis === "per_linear_ft");
  const width = Number(w) || 0;
  const height = Number(h) || 0;
  const r = calculatePrice(
    config,
    {
      quantity: Number(qty) || 0,
      widthIn: needsSize ? width : null,
      heightIn: needsSize ? height : null,
      materialCostCents: config.method === "per_sqft" && mat ? mat.costCents : null,
      finishingKeys: picked.filter((k) => config.finishingOptions?.some((o) => o.key === k)),
      needsDesign: design,
      needsInstall: install,
      isRush: rush,
      customBaseCents: config.method === "custom" ? parseMoney(base) : null,
    },
    rules,
  );
  const q = Number(qty) || 0;
  const low = r.marginPct != null && r.marginPct < r.targetMarginPct;

  return (
    <Card className="border-brand-200">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Calculator className="size-5 text-brand-500" /> Try it
          </span>
        }
        description="Enter an example job to see what these rules would charge. Nothing is saved."
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Quantity" htmlFor="t-qty">
            <Input id="t-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} className="tabular" />
          </Field>
          {needsSize && (
            <>
              <Field label="Width (in)" htmlFor="t-w">
                <Input id="t-w" inputMode="decimal" value={w} onChange={(e) => setW(e.target.value)} className="tabular" />
              </Field>
              <Field label="Height (in)" htmlFor="t-h">
                <Input id="t-h" inputMode="decimal" value={h} onChange={(e) => setH(e.target.value)} className="tabular" />
              </Field>
            </>
          )}
        </div>
        {needsSize && width > 0 && height > 0 && (
          <p className="-mt-2 text-sm text-slate-500">
            {fmtSize(width, height)} · {((width * height) / 144).toFixed(1)} sq ft each
          </p>
        )}
        {config.method === "per_sqft" && sqftMats.length > 0 && (
          <Field label="Material" htmlFor="t-mat">
            <Select id="t-mat" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
              <option value="">Standard (use the cost above)</option>
              {sqftMats.map((mt) => (
                <option key={mt.id} value={mt.id}>
                  {mt.name} — {money(mt.costCents)}/sq ft
                </option>
              ))}
            </Select>
          </Field>
        )}
        {config.method === "custom" && (
          <Field label="Price entered by hand" htmlFor="t-base">
            <MoneyInput id="t-base" value={base} onChange={(e) => setBase(e.target.value)} />
          </Field>
        )}
        {(config.finishingOptions?.length ?? 0) > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Finishing</p>
            {config.finishingOptions!.map((o) => (
              <Checkbox
                key={o.key}
                label={o.label}
                checked={picked.includes(o.key)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, o.key] : picked.filter((k) => k !== o.key))}
              />
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Checkbox label="Needs design" checked={design} onChange={(e) => setDesign(e.target.checked)} />
          <Checkbox label="Needs install" checked={install} onChange={(e) => setInstall(e.target.checked)} />
          <Checkbox label="Rush" checked={rush} onChange={(e) => setRush(e.target.checked)} />
        </div>

        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-500">Recommended price</p>
          <p className="text-3xl font-semibold tracking-tight text-slate-900 tabular">{money(r.recommendedCents)}</p>
          {q > 1 && r.recommendedCents > 0 && <p className="text-sm text-slate-500 tabular">{money(r.recommendedCents / q)} each</p>}
          <dl className="mt-3 space-y-1.5 text-[15px]">
            {r.lines.map((l, i) => (
              <div key={i} className="flex justify-between gap-3">
                <dt className="min-w-0 text-slate-700">
                  {l.label}
                  {l.detail && <span className="block text-xs text-slate-500">{l.detail}</span>}
                </dt>
                <dd className="shrink-0 text-slate-900 tabular">{money(l.cents)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 border-t border-slate-200 pt-3">
            <div className="flex justify-between text-[15px]">
              <span className="text-slate-700">Our estimated cost</span>
              <span className="tabular">{money(r.estimatedCostCents)}</span>
            </div>
            {r.costLines.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                {r.costLines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>{l.label}</span>
                    <span className="tabular">{money(l.cents)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex justify-between text-[15px]">
              <span className="text-slate-700">Margin</span>
              <span className={cn("font-semibold tabular", low ? "text-red-700" : "text-emerald-700")}>
                {r.estimatedCostCents > 0 ? pct(r.marginPct) : "No cost entered"}
                <span className="font-normal text-slate-500"> · target {pct(r.targetMarginPct)}</span>
              </span>
            </div>
          </div>
        </div>
        {r.warnings.length > 0 && (
          <ul className="space-y-1.5">
            {r.warnings.map((wn) => (
              <li key={wn} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {wn}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Print estimating (sheet_fed)
// ---------------------------------------------------------------------------
const COLOR_OPTIONS: [string, string][] = [
  ["4", "Full color (4)"],
  ["1", "Black or 1 color"],
  ["2", "2 colors"],
  ["3", "3 colors"],
  ["5", "5 colors (4 + spot)"],
  ["6", "6 colors"],
];
const BACK_OPTIONS: [string, string][] = [["0", "Blank"], ...COLOR_OPTIONS];

const perM = (c: number) => `${money(c)}/1,000`;

function Choice({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="text-[15px] font-semibold text-slate-900">{title}</p>
      {hint && <p className="mt-0.5 text-sm text-slate-500">{hint}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

function Radio({ checked, onChange, label, name }: { checked: boolean; onChange: () => void; label: React.ReactNode; name: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[15px] text-slate-800">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="size-4 accent-brand-500" />
      {label}
    </label>
  );
}

function MissingCatalog({ what, href }: { what: string; href: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>
        No {what} yet.{" "}
        <Link href={href} className="font-medium underline">
          Add {what}
        </Link>{" "}
        to estimate this category.
      </span>
    </p>
  );
}

const toggle = (ids: number[], id: number, on: boolean) => (on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id));

function PrintSettings({ value: v, onChange, catalog }: { value: PrintForm; onChange: (v: PrintForm) => void; catalog: PrintCatalog }) {
  const set = <K extends keyof PrintForm>(k: K, val: PrintForm[K]) => onChange({ ...v, [k]: val });
  const allowedPapers = v.paperMode === "some" ? catalog.papers.filter((p) => v.paperIds.includes(p.id)) : catalog.papers;
  return (
    <div className="space-y-4">
      <Choice title="Paper" hint="Which paper stocks someone can pick for this kind of work.">
        {catalog.papers.length === 0 ? (
          <MissingCatalog what="paper stocks" href="/settings/paper" />
        ) : (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Radio name="paper-mode" checked={v.paperMode === "all"} onChange={() => set("paperMode", "all")} label="All paper stocks (new ones too)" />
              <Radio name="paper-mode" checked={v.paperMode === "some"} onChange={() => set("paperMode", "some")} label="Only the ones I pick" />
            </div>
            {v.paperMode === "some" && (
              <div className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
                {catalog.papers.map((p) => (
                  <Checkbox
                    key={p.id}
                    label={p.name}
                    hint={perM(p.costPerMCents)}
                    checked={v.paperIds.includes(p.id)}
                    onChange={(e) => set("paperIds", toggle(v.paperIds, p.id, e.target.checked))}
                  />
                ))}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Usual paper" htmlFor="pr-paper" hint="Picked for you on a new quote line.">
                <Select id="pr-paper" value={v.defaultPaperId} onChange={(e) => set("defaultPaperId", e.target.value)}>
                  <option value="">— Someone picks each time —</option>
                  {allowedPapers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Markup on paper" htmlFor="pr-markup" hint="Added to what the paper costs us, unless the paper has its own markup.">
                <SuffixInput id="pr-markup" suffix="%" value={v.paperMarkupPct} onChange={(e) => set("paperMarkupPct", e.target.value)} placeholder="30" />
              </Field>
            </div>
          </>
        )}
      </Choice>

      <Choice title="Presses" hint="With no press picked on a quote, we price it on each of these and suggest the cheapest.">
        {catalog.presses.length === 0 ? (
          <MissingCatalog what="presses" href="/settings/equipment" />
        ) : (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Radio name="press-mode" checked={v.pressMode === "all"} onChange={() => set("pressMode", "all")} label="All digital & offset presses" />
              <Radio name="press-mode" checked={v.pressMode === "some"} onChange={() => set("pressMode", "some")} label="Only the ones I pick" />
            </div>
            {v.pressMode === "some" && (
              <div className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
                {catalog.presses.map((p) => (
                  <Checkbox
                    key={p.id}
                    label={p.name}
                    hint={p.kind === "digital" ? "Digital" : "Offset"}
                    checked={v.pressIds.includes(p.id)}
                    onChange={(e) => set("pressIds", toggle(v.pressIds, p.id, e.target.checked))}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </Choice>

      <Choice title="Added by default" hint="Bindery & services ticked on every new quote line in this category. People can untick them or add others.">
        {catalog.operations.length === 0 ? (
          <MissingCatalog what="bindery services" href="/settings/services" />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {catalog.operations.map((o) => (
              <Checkbox key={o.id} label={o.name} checked={v.opIds.includes(o.id)} onChange={(e) => set("opIds", toggle(v.opIds, o.id, e.target.checked))} />
            ))}
          </div>
        )}
      </Choice>

      <Choice title="The usual job" hint="Starting choices on a new quote line — people can change them.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Sides / pages" htmlFor="pr-sides">
            <Select id="pr-sides" value={v.sides} onChange={(e) => set("sides", e.target.value as PrintForm["sides"])}>
              <option value="1">One-sided</option>
              <option value="2">Two-sided</option>
              <option value="multi">Booklet / multi-page</option>
            </Select>
          </Field>
          {v.sides === "multi" && (
            <Field label="Pages" htmlFor="pr-pages" hint="Every page is one printed side.">
              <Input id="pr-pages" inputMode="numeric" value={v.pageCount} onChange={(e) => set("pageCount", e.target.value)} className="tabular" />
            </Field>
          )}
          <Field label={v.sides === "2" ? "Front colors" : "Ink colors"} htmlFor="pr-cf">
            <Select id="pr-cf" value={v.colorsFront} onChange={(e) => set("colorsFront", e.target.value)}>
              {COLOR_OPTIONS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          {v.sides === "2" && (
            <Field label="Back colors" htmlFor="pr-cb">
              <Select id="pr-cb" value={v.colorsBack} onChange={(e) => set("colorsBack", e.target.value)}>
                {BACK_OPTIONS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <Checkbox
              label="The design usually bleeds (color runs off the edge)"
              hint="Adds the bleed below on every edge, so fewer pieces may fit on a sheet."
              checked={v.defaultBleed}
              onChange={(e) => set("defaultBleed", e.target.checked)}
            />
          </div>
          <Field label="Bleed size" htmlFor="pr-bleed" hint={'Per edge. Usually 1/8" (0.125).'}>
            <SuffixInput id="pr-bleed" suffix="in" value={v.bleedIn} onChange={(e) => set("bleedIn", e.target.value)} placeholder="0.125" />
          </Field>
          <Field label="Space between pieces" htmlFor="pr-gutter" hint="Gap left between pieces on the sheet. Usually none.">
            <SuffixInput id="pr-gutter" suffix="in" value={v.gutterIn} onChange={(e) => set("gutterIn", e.target.value)} placeholder="0" />
          </Field>
        </div>
      </Choice>
    </div>
  );
}

/** A likely example size for the preview, from the category name. */
function exampleSize(name: string): [string, string] {
  const s = name.toLowerCase();
  if (s.includes("postcard")) return ["6", "4"];
  if (s.includes("card")) return ["3.5", "2"];
  if (s.includes("brochure")) return ["11", "8.5"];
  if (s.includes("booklet")) return ["5.5", "8.5"];
  return ["8.5", "11"];
}

function PrintTryIt({ config, rules, catalog, categoryName }: { config: PricingConfig; rules: BusinessRules; catalog: PrintCatalog; categoryName: string }) {
  const pc = (config.print ?? {}) as SavedPrintConfig;
  const [dw, dh] = exampleSize(categoryName);
  const [qty, setQty] = React.useState("500");
  const [w, setW] = React.useState(dw);
  const [h, setH] = React.useState(dh);
  // Overrides; null = follow the category's settings on the left.
  const [sides, setSides] = React.useState<string | null>(null);
  const [cf, setCf] = React.useState<string | null>(null);
  const [cb, setCb] = React.useState<string | null>(null);
  const [bleed, setBleed] = React.useState<boolean | null>(null);
  const [paper, setPaper] = React.useState<string | null>(null);
  const [press, setPress] = React.useState("");
  // Services ticked; null = the category's defaults (pre-ticked, like a new quote line).
  const [ops, setOps] = React.useState<number[] | null>(null);
  const [rush, setRush] = React.useState(false);

  const papers = pc.paperIds?.length ? catalog.papers.filter((p) => pc.paperIds!.includes(p.id)) : catalog.papers;
  const presses = pc.pressIds?.length ? catalog.presses.filter((p) => pc.pressIds!.includes(p.id)) : catalog.presses;
  const defaultPages = pc.defaultPages ?? 1;
  const pagesSel = sides ?? String(defaultPages);
  const pages = Number(pagesSel) || 1;
  const colorsFront = Number(cf ?? pc.defaultColorsFront ?? 4);
  const colorsBack = pages === 2 ? Number(cb ?? pc.defaultColorsBack ?? 4) : 0;
  const bleeds = bleed ?? pc.defaultBleed ?? false;
  const paperSel = paper && papers.some((p) => String(p.id) === paper) ? paper : String(pc.defaultPaperId ?? papers[0]?.id ?? "");
  const pressSel = press && presses.some((p) => String(p.id) === press) ? press : "";
  const defaults = new Set(pc.defaultOperationIds ?? []);
  const opIds = ops ?? [...defaults];
  const q = Number(qty.replace(/,/g, "")) || 0;

  const r = calculatePrice(
    config,
    {
      quantity: q,
      widthIn: Number(w) || 0,
      heightIn: Number(h) || 0,
      isRush: rush,
      print: {
        pages,
        colorsFront,
        colorsBack,
        bleed: bleeds,
        paperId: paperSel ? Number(paperSel) : null,
        pressId: pressSel ? Number(pressSel) : null,
        // The full list, like the quote builder sends (defaults included).
        operationIds: opIds,
      },
    },
    rules,
    catalog,
  );
  const prod = r.production;
  const low = r.marginPct != null && r.marginPct < r.targetMarginPct;
  const pageOptions: [string, string][] = [
    ["1", "One-sided"],
    ["2", "Two-sided"],
    ...(defaultPages > 2 ? [[String(defaultPages), `${defaultPages} pages`] as [string, string]] : []),
    ...[4, 8, 12, 16, 24].filter((n) => n !== defaultPages).map((n) => [String(n), `${n} pages`] as [string, string]),
  ];

  return (
    <Card className="border-brand-200">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Calculator className="size-5 text-brand-500" /> Try it
          </span>
        }
        description="An example job, priced with your paper, presses and services. Nothing is saved."
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Quantity" htmlFor="pt-qty">
            <Input id="pt-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} className="tabular" />
          </Field>
          <Field label="Width (in)" htmlFor="pt-w">
            <Input id="pt-w" inputMode="decimal" value={w} onChange={(e) => setW(e.target.value)} className="tabular" />
          </Field>
          <Field label="Height (in)" htmlFor="pt-h">
            <Input id="pt-h" inputMode="decimal" value={h} onChange={(e) => setH(e.target.value)} className="tabular" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sides / pages" htmlFor="pt-sides">
            <Select id="pt-sides" value={pagesSel} onChange={(e) => setSides(e.target.value)}>
              {pageOptions.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={pages === 2 ? "Colors front / back" : "Ink colors"} htmlFor="pt-cf">
            <div className="flex gap-2">
              <Select id="pt-cf" value={String(colorsFront)} onChange={(e) => setCf(e.target.value)} aria-label="Front colors">
                {COLOR_OPTIONS.map(([k]) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
              {pages === 2 && (
                <Select value={String(colorsBack)} onChange={(e) => setCb(e.target.value)} aria-label="Back colors">
                  {BACK_OPTIONS.map(([k]) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          </Field>
        </div>
        <Field label="Paper" htmlFor="pt-paper">
          <Select id="pt-paper" value={paperSel} onChange={(e) => setPaper(e.target.value)} disabled={!papers.length}>
            {!papers.length && <option value="">No paper stocks yet</option>}
            {papers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Press" htmlFor="pt-press">
          <Select id="pt-press" value={pressSel} onChange={(e) => setPress(e.target.value)} disabled={!presses.length}>
            <option value="">{presses.length ? "Best price (cheapest press)" : "No presses yet"}</option>
            {presses.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        {catalog.operations.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Bindery & services</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {catalog.operations.map((o) => (
                <Checkbox
                  key={o.id}
                  label={o.name}
                  hint={defaults.has(o.id) ? "on by default" : undefined}
                  checked={opIds.includes(o.id)}
                  onChange={(e) => setOps(toggle(opIds, o.id, e.target.checked))}
                />
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Checkbox label="Bleeds" checked={bleeds} onChange={(e) => setBleed(e.target.checked)} />
          <Checkbox label="Rush" checked={rush} onChange={(e) => setRush(e.target.checked)} />
        </div>

        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-500">Recommended price</p>
          <p className="text-3xl font-semibold tracking-tight text-slate-900 tabular">{money(r.recommendedCents)}</p>
          {q > 1 && r.recommendedCents > 0 && <p className="text-sm text-slate-500 tabular">{money(r.recommendedCents / q)} each</p>}
          <dl className="mt-3 space-y-1.5 text-[15px]">
            {r.lines.map((l, i) => (
              <div key={i} className="flex justify-between gap-3">
                <dt className="min-w-0 text-slate-700">
                  {l.label}
                  {l.detail && <span className="block text-xs text-slate-500">{l.detail}</span>}
                </dt>
                <dd className="shrink-0 text-slate-900 tabular">{money(l.cents)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 border-t border-slate-200 pt-3">
            <div className="flex justify-between text-[15px]">
              <span className="text-slate-700">Our estimated cost</span>
              <span className="tabular">{money(r.estimatedCostCents)}</span>
            </div>
            <div className="mt-1 flex justify-between text-[15px]">
              <span className="text-slate-700">Margin</span>
              <span className={cn("font-semibold tabular", low ? "text-red-700" : "text-emerald-700")}>
                {r.estimatedCostCents > 0 ? pct(r.marginPct) : "No cost entered"}
                <span className="font-normal text-slate-500"> · target {pct(r.targetMarginPct)}</span>
              </span>
            </div>
          </div>
        </div>

        {prod && (
          <div className="rounded-xl border border-slate-200 p-4 text-[15px]">
            <p className="font-semibold text-slate-900">How it runs</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-slate-500">Press</dt>
              <dd className="text-slate-800">{prod.pressName}</dd>
              <dt className="text-slate-500">Layout</dt>
              <dd className="text-slate-800">
                {prod.ups} up ({prod.layout}) on a {prod.pressSheet} sheet
              </dd>
              <dt className="text-slate-500">Paper</dt>
              <dd className="text-slate-800">
                {prod.parentSheets.toLocaleString("en-US")} × {prod.paperName}
                {prod.outs > 1 ? `, cut ${prod.outs} out of each ${prod.parentSheet}` : ""}
              </dd>
              <dt className="text-slate-500">Press sheets</dt>
              <dd className="text-slate-800 tabular">
                {prod.pressSheets.toLocaleString("en-US")} ({prod.netSheets.toLocaleString("en-US")} + {prod.spoilageSheets.toLocaleString("en-US")} spoilage)
              </dd>
              <dt className="text-slate-500">Printing</dt>
              <dd className="text-slate-800">
                {prod.sidesPrinted === 2 ? "Both sides" : "One side"}
                {prod.plates ? `, ${prod.plates} plates, ${prod.passes} pass${prod.passes === 1 ? "" : "es"}` : ""}
                {prod.runHours ? `, about ${prod.runHours} hr on press` : ""}
              </dd>
            </dl>
            {(r.pressOptions?.length ?? 0) > 1 && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="text-sm font-medium text-slate-700">Other presses</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {r.pressOptions!.map((o) => (
                    <li key={o.pressId} className={cn("flex justify-between gap-3", o.pressId === prod.pressId ? "font-medium text-emerald-700" : "text-slate-600")}>
                      <span>
                        {o.pressName}
                        {o.pressId === prod.pressId ? " — chosen" : ""}
                      </span>
                      <span className="tabular">{money(o.priceCents)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-slate-500">Printing, paper and bindery only — before rush, discounts and minimums.</p>
              </div>
            )}
          </div>
        )}
        {r.warnings.length > 0 && (
          <ul className="space-y-1.5">
            {r.warnings.map((wn) => (
              <li key={wn} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {wn}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
