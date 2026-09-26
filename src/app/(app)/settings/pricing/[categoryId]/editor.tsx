"use client";
import * as React from "react";
import { AlertTriangle, Calculator, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  calculatePrice,
  type BusinessRules,
  type FinishingOption,
  type PricingConfig,
  type PricingMethod,
} from "@/lib/pricing/engine";
import { BASIS_LABELS, GROUP_LABELS, PRICING_METHOD_HINTS, PRICING_METHOD_LABELS, slugify } from "@/lib/admin/pricing-labels";
import { centsToInput, fmtSize, money, parseMoney, pct } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, MoneyInput, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SuffixInput } from "../../_components/inputs";
import { savePricingRule } from "../actions";

type Loc = { id: number; name: string };
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
  set("wastePct", pct$(f.wastePct, "Waste"));
  set("machineHours", num$(f.machineHours, "Machine hours"));
  set("machineCostPerHourCents", money$(f.machineCostPerHour, "Machine cost per hour"));
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
}: {
  categoryId: number;
  category: CategoryFields;
  config: PricingConfig;
  notes: string;
  rules: BusinessRules;
  locations: Loc[];
  materials: Mat[];
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
          <CardHeader title="Setup, time & waste" description="Leave a box empty if it doesn't apply." />
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
            <Field label="Machine time per job" htmlFor="c-mh" hint="Counts toward our cost only.">
              <SuffixInput id="c-mh" suffix="hr" {...txt("machineHours")} />
            </Field>
            <Field label="Machine cost per hour" htmlFor="c-mc" hint="What running the machine costs us.">
              <MoneyInput id="c-mc" {...txt("machineCostPerHour")} />
            </Field>
            <Field label="Extra material for waste" htmlFor="c-waste" hint="Adds to our cost only.">
              <SuffixInput id="c-waste" suffix="%" {...txt("wastePct")} />
            </Field>
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
          <CardHeader title="Finishing options" description="Extras someone can tick on a quote, like grommets, lamination or rounded corners." />
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
        <TryIt key={form.method} config={config} rules={rules} materials={materials} />
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
