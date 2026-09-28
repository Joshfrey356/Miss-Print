"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Factory, Loader2, Minus, PackagePlus, Pencil, Plus, ShoppingCart, Trash2, User, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, MoneyInput, Select, Textarea } from "@/components/ui/input";
import Link from "next/link";
import { CustomerPicker, type PickedCustomer } from "@/components/customer-picker";
import { centsToInput, money, parseMoney } from "@/lib/format";
import { cartTotals, lineTotal } from "@/lib/counter/math";
import { PRINT_QUANTITIES, PRINT_SIZES, printDescription, type CounterPrintOptions } from "@/lib/counter/print";
import { cn } from "@/lib/utils";
import { createSaleAction, priceCounterLine } from "../actions";

export type CounterCategory = {
  id: number;
  name: string;
  group: string;
  /** "tier" (quantity breaks), "unit" (per piece), "sqft" (by size), "print" (print estimator) or "manual" (enter a price). */
  kind: "tier" | "unit" | "sqft" | "print" | "manual";
  quickQty: number[];
  /** Print categories: the papers it allows (names only) and its defaults. */
  print?: CounterPrintOptions | null;
};

type Line = {
  key: string;
  categoryId: number | null;
  kind: CounterCategory["kind"];
  description: string;
  quantity: number;
  widthIn: number | null;
  heightIn: number | null;
  /** Manual lines: price each. */
  unitCents: number;
  /** Price-list lines: the line total (recommended, or typed over). */
  amountCents: number;
  recommendedCents: number | null;
  priceEdited: boolean;
  taxable: boolean;
  /** Print lines: 1 = one-sided, 2 = two-sided, and the paper. */
  pages: 1 | 2;
  paperId: number | null;
  /** The description was typed (otherwise print lines describe themselves). */
  descEdited: boolean;
};

const amountOf = (l: Line) => (l.kind === "manual" ? lineTotal(l.quantity, l.unitCents) : l.amountCents);
const newKey = () => Math.random().toString(36).slice(2);
const bigBtn = "flex min-h-16 flex-col items-start justify-center rounded-xl border px-4 py-3 text-left transition-colors active:scale-[0.99]";

export function SaleBuilder({ categories, taxRate, canCreateJobs, today }: { categories: CounterCategory[]; taxRate: number; canCreateJobs: boolean; today: string }) {
  const router = useRouter();
  const [walkIn, setWalkIn] = React.useState(true);
  const [customer, setCustomer] = React.useState<PickedCustomer | null>(null);
  const [lines, setLines] = React.useState<Line[]>([]);
  const [editing, setEditing] = React.useState<Line | null>(null);
  const [production, setProduction] = React.useState(false);
  const [jobTitle, setJobTitle] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [instructions, setInstructions] = React.useState("");
  const [po, setPo] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [pending, start] = React.useTransition();

  const exempt = !walkIn && !!customer?.taxExempt;
  const totals = cartTotals(lines.map((l) => ({ amountCents: amountOf(l), taxable: l.taxable })), taxRate, exempt);
  const ratePct = `${(taxRate * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
  const customerReady = walkIn || !!customer;

  const openNew = (cat: CounterCategory | null) => {
    const isPrint = cat?.kind === "print";
    const size = isPrint ? (/card/i.test(cat!.name) ? PRINT_SIZES[0] : /post/i.test(cat!.name) ? PRINT_SIZES[1] : PRINT_SIZES[3]) : null;
    const pages = cat?.print?.defaultPages ?? 1;
    const paperId = cat?.print?.defaultPaperId ?? null;
    setEditing({
      key: "",
      categoryId: cat?.id ?? null,
      kind: cat?.kind ?? "manual",
      description: isPrint ? printDescription(cat!.name, size!.w, size!.h, pages, cat!.print?.papers.find((p) => p.id === paperId)?.name ?? null) : cat ? cat.name : "",
      quantity: isPrint ? 500 : cat?.quickQty[0] ?? 1,
      widthIn: cat?.kind === "sqft" ? 24 : size ? size.w : null,
      heightIn: cat?.kind === "sqft" ? 36 : size ? size.h : null,
      unitCents: 0,
      amountCents: 0,
      recommendedCents: null,
      priceEdited: false,
      taxable: true,
      pages,
      paperId,
      descEdited: false,
    });
  };

  const saveLine = (l: Line) => {
    setLines((ls) => (l.key ? ls.map((x) => (x.key === l.key ? l : x)) : [...ls, { ...l, key: newKey() }]));
    setEditing(null);
  };


  const submit = () => {
    if (!customerReady) return toast.error("Choose the customer, or tap Walk-in.");
    if (!lines.length) return toast.error("Add at least one item to the sale.");
    if (!walkIn && customer?.poRequired && !po.trim()) return toast.error(`${customer.name} requires a PO number.`);
    start(async () => {
      const r = await createSaleAction({
        customerId: walkIn ? null : customer!.id,
        lines: lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          amountCents: amountOf(l),
          taxable: l.taxable,
          categoryId: l.categoryId,
          widthIn: l.widthIn,
          heightIn: l.heightIn,
          recommendedCents: l.recommendedCents,
          print: l.kind === "print" ? { pages: l.pages, paperId: l.paperId } : null,
        })),
        poNumber: po.trim() || null,
        notes: notes.trim() || null,
        production: production ? { title: jobTitle.trim(), dueDate: dueDate || null, instructions: instructions.trim() || null } : null,
      });
      if (!r.ok) return void toast.error(r.error);
      if (r.data?.jobNumber) toast.success("Added to the production board");
      router.push(`/counter/sale/${r.data!.id}`);
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0 space-y-5">
        {/* Customer */}
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Customer</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setWalkIn(true)} className={cn(bigBtn, "min-h-14 flex-row items-center gap-2", walkIn ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-300 bg-white text-slate-700")}>
              <User className="size-5" />
              <span className="text-base font-semibold">Walk-in</span>
            </button>
            <button type="button" onClick={() => setWalkIn(false)} className={cn(bigBtn, "min-h-14 flex-row items-center gap-2", !walkIn ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-300 bg-white text-slate-700")}>
              <Users className="size-5" />
              <span className="text-base font-semibold">Customer on file</span>
            </button>
          </div>
          {!walkIn && (
            <div className="mt-3">
              <CustomerPicker value={customer} onChange={setCustomer} autoFocus />
            </div>
          )}
          {!walkIn && customer?.poRequired && (
            <Field label="PO number" required className="mt-3" htmlFor="sale-po">
              <Input id="sale-po" value={po} onChange={(e) => setPo(e.target.value)} className="h-12 text-base" maxLength={100} />
            </Field>
          )}
        </Card>

        {/* Items */}
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Add an item</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {categories.map((c) => (
              <button key={c.id} type="button" onClick={() => openNew(c)} className={cn(bigBtn, "border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/50")}>
                <span className="text-[15px] font-semibold leading-tight text-slate-900">{c.name}</span>
                <span className="mt-0.5 text-xs text-slate-500">{c.kind === "tier" ? "Price by quantity" : c.kind === "unit" ? "Price each" : c.kind === "sqft" ? "Price by size" : c.kind === "print" ? "Printed — size, sides, paper" : "Enter a price"}</span>
              </button>
            ))}
            <button type="button" onClick={() => openNew(null)} className={cn(bigBtn, "border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100")}>
              <span className="flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
                <PackagePlus className="size-4" /> Custom item
              </span>
              <span className="mt-0.5 text-xs text-slate-500">Type a description and price</span>
            </button>
          </div>
        </Card>

      </div>

      {/* The sale: lines, totals and pay (right column on wide screens, so it's always in view) */}
      <div className="space-y-4 lg:order-last">
      <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">This sale</p>
            {lines.length > 0 && (
              <button type="button" className="text-sm text-slate-500 hover:text-red-700" onClick={() => setLines([])}>
                Clear all
              </button>
            )}
          </div>
          {lines.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-10 text-center text-slate-500">
              <ShoppingCart className="mb-2 size-8 text-slate-300" />
              <p className="text-[15px]">Nothing on this sale yet. Tap an item to add it.</p>
            </div>
          ) : (
            <ul className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto">
              {lines.map((l) => (
                <li key={l.key} className="flex min-h-16 items-center gap-2 px-4 py-2">
                  <button type="button" onClick={() => setEditing(l)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-base font-medium text-slate-900">{l.description}</p>
                    <p className="text-sm text-slate-500">
                      Qty {l.quantity.toLocaleString()}
                      {l.kind === "manual" ? ` × ${money(l.unitCents)}` : ""}
                      {l.kind !== "print" && l.widthIn && l.heightIn ? ` · ${l.widthIn}" × ${l.heightIn}"` : ""}
                      {!l.taxable && " · not taxed"}
                      {l.priceEdited && l.recommendedCents != null && l.recommendedCents !== l.amountCents && ` · list price ${money(l.recommendedCents)}`}
                    </p>
                  </button>
                  <p className="shrink-0 text-right text-base font-semibold tabular text-slate-900">{money(amountOf(l))}</p>
                  <Button size="lg" variant="ghost" className="-mr-2 w-11 shrink-0 px-0 text-slate-400 hover:text-red-700" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    <Trash2 className="size-5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4">
          <dl className="space-y-1.5 text-[15px]">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="tabular">{money(totals.subtotalCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">{exempt ? "Sales tax (tax exempt)" : `Sales tax (${ratePct})`}</dt>
              <dd className="tabular">{money(totals.taxCents)}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-slate-200 pt-2">
              <dt className="text-lg font-semibold text-slate-900">Total</dt>
              <dd className="text-3xl font-bold tabular text-slate-900">{money(totals.totalCents)}</dd>
            </div>
          </dl>

          {canCreateJobs && (
            <div className="mt-4 rounded-xl border border-slate-200 p-3">
              <label className="flex cursor-pointer items-center gap-3">
                <input type="checkbox" checked={production} onChange={(e) => setProduction(e.target.checked)} className="size-6 accent-brand-500" />
                <span>
                  <span className="flex items-center gap-1.5 font-semibold text-slate-900">
                    <Factory className="size-4" /> Needs production
                  </span>
                  <span className="block text-sm text-slate-500">Also put it on the production board as a job.</span>
                </span>
              </label>
              {production && (
                <div className="mt-3 space-y-3">
                  <Field label="Job title" htmlFor="job-title">
                    <Input id="job-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder={lines[0]?.description ?? "e.g. 500 business cards"} className="h-11" maxLength={200} />
                  </Field>
                  <Field label="Due date" htmlFor="job-due">
                    <Input id="job-due" type="date" min={today} value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-11" />
                  </Field>
                  <Field label="Instructions for production" htmlFor="job-notes">
                    <Textarea id="job-notes" rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={4000} placeholder="Paper, finishing, pickup time…" />
                  </Field>
                </div>
              )}
            </div>
          )}

          <Field label="Note on the receipt" htmlFor="sale-notes" className="mt-4">
            <Input id="sale-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Optional" className="h-11" />
          </Field>

          <Button variant="success" size="lg" className="mt-4 h-16 w-full text-lg" disabled={pending || !lines.length || !customerReady || totals.totalCents <= 0} onClick={submit}>
            {pending ? <Loader2 className="size-5 animate-spin" /> : null}
            Take payment · {money(totals.totalCents)}
          </Button>
          {!customerReady && <p className="mt-2 text-center text-sm text-slate-500">Choose the customer first.</p>}
        </Card>
      </div>

      <LineEditor line={editing} customerId={walkIn ? null : customer?.id ?? null} categories={categories} onCancel={() => setEditing(null)} onSave={saveLine} />
    </div>
  );
}

function LineEditor({ line, customerId, categories, onCancel, onSave }: { line: Line | null; customerId: number | null; categories: CounterCategory[]; onCancel: () => void; onSave: (l: Line) => void }) {
  const [l, setL] = React.useState<Line | null>(line);
  const [priceText, setPriceText] = React.useState("");
  const [pricing, setPricing] = React.useState(false);
  const [priceNote, setPriceNote] = React.useState<string | null>(null);
  const [runNote, setRunNote] = React.useState<string | null>(null);
  React.useEffect(() => {
    setL(line);
    setPriceText(line ? centsToInput(line.kind === "manual" ? line.unitCents : line.amountCents) : "");
    setPriceNote(null);
    setRunNote(null);
  }, [line]);

  const editedRef = React.useRef(false);
  editedRef.current = !!l?.priceEdited;
  const cat = l?.categoryId ? categories.find((c) => c.id === l.categoryId) : null;
  const priced = !!l && l.kind !== "manual" && !!l.categoryId;

  // Look up the price list whenever quantity or size changes.
  React.useEffect(() => {
    if (!l || !priced) return;
    if ((l.kind === "sqft" || l.kind === "print") && !(l.widthIn && l.heightIn)) return;
    let live = true;
    setPricing(true);
    const t = setTimeout(async () => {
      const r = await priceCounterLine({
        categoryId: l.categoryId!,
        quantity: l.quantity,
        widthIn: l.widthIn,
        heightIn: l.heightIn,
        customerId,
        print: l.kind === "print" ? { pages: l.pages, paperId: l.paperId } : null,
      });
      if (!live) return;
      setPricing(false);
      if (!r.ok) {
        setRunNote(null);
        return setPriceNote(r.error);
      }
      const rec = r.data!.recommendedCents;
      setPriceNote(r.data!.warnings[0] ?? null);
      setRunNote(r.data!.production);
      // The estimate is the LINE TOTAL for the whole quantity; no estimate = type a price.
      // A price for a different size/paper would be misleading: clear it unless someone typed one.
      setL((cur) => (cur ? { ...cur, recommendedCents: rec, amountCents: cur.priceEdited ? cur.amountCents : (rec ?? 0) } : cur));
      if (!editedRef.current) setPriceText(rec != null ? centsToInput(rec) : "");
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l?.categoryId, l?.quantity, l?.widthIn, l?.heightIn, l?.pages, l?.paperId, customerId, priced]);

  if (!l) return null;
  const set = (patch: Partial<Line>) => {
    const next = { ...l, ...patch };
    // Printed items describe themselves (size, sides, paper) until someone types a description.
    if (next.kind === "print" && !next.descEdited && cat)
      next.description = printDescription(cat.name, next.widthIn, next.heightIn, next.pages, cat.print?.papers.find((p) => p.id === next.paperId)?.name ?? null);
    setL(next);
  };
  const total = amountOf(l);
  const quick = cat?.quickQty ?? [1, 2, 5, 10, 25, 50, 100];
  const needsSize = l.kind === "sqft" || l.kind === "print";
  const canSave = l.description.trim() && l.quantity >= 1 && (needsSize ? l.widthIn && l.heightIn : true) && (l.kind === "print" ? total > 0 : true);

  return (
    <Dialog open={!!line} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent title={cat ? cat.name : "Custom item"} description={l.key ? "Change this item." : "Set the quantity and price, then add it to the sale."} wide>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) onSave(l);
          }}
        >
          <Field label="Description" htmlFor="line-desc" required>
            <Input id="line-desc" value={l.description} onChange={(e) => set({ description: e.target.value, descEdited: true })} className="h-12 text-base" maxLength={500} autoFocus={!cat} placeholder="e.g. Color copies, 8.5×11" />
          </Field>

          <Field label="Quantity" htmlFor="line-qty" required>
            <div className="flex items-center gap-2">
              <Button size="lg" className="h-14 w-14 px-0" aria-label="One less" onClick={() => set({ quantity: Math.max(1, l.quantity - 1) })}>
                <Minus className="size-5" />
              </Button>
              <Input
                id="line-qty"
                inputMode="numeric"
                value={String(l.quantity)}
                onChange={(e) => set({ quantity: Math.max(1, Math.min(10_000_000, Math.round(Number(e.target.value.replace(/\D/g, "")) || 1))) })}
                className="h-14 w-32 text-center text-xl font-semibold tabular"
              />
              <Button size="lg" className="h-14 w-14 px-0" aria-label="One more" onClick={() => set({ quantity: l.quantity + 1 })}>
                <Plus className="size-5" />
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {quick.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => set({ quantity: q })}
                  className={cn("h-11 min-w-14 rounded-lg border px-3 text-[15px] font-medium tabular", l.quantity === q ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-300 bg-white text-slate-700")}
                >
                  {q.toLocaleString()}
                </button>
              ))}
            </div>
          </Field>

          {l.kind === "print" && (
            <>
              <Field label="Finished size (inches)" required>
                <div className="flex flex-wrap gap-2">
                  {PRINT_SIZES.map((sz) => (
                    <button
                      key={sz.label}
                      type="button"
                      onClick={() => set({ widthIn: sz.w, heightIn: sz.h })}
                      className={cn("h-12 rounded-lg border px-3 text-left text-sm leading-tight", l.widthIn === sz.w && l.heightIn === sz.h ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-300 bg-white text-slate-700")}
                    >
                      <span className="block font-medium">{sz.label}</span>
                      <span className="block text-xs tabular text-slate-500">
                        {sz.w} × {sz.h}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Input aria-label="Width (inches)" inputMode="decimal" value={l.widthIn ?? ""} onChange={(e) => set({ widthIn: Number(e.target.value) > 0 ? Number(e.target.value) : null })} className="h-12 w-24 text-center text-base tabular" />
                  <span className="text-slate-500">×</span>
                  <Input aria-label="Height (inches)" inputMode="decimal" value={l.heightIn ?? ""} onChange={(e) => set({ heightIn: Number(e.target.value) > 0 ? Number(e.target.value) : null })} className="h-12 w-24 text-center text-base tabular" />
                  <span className="text-sm text-slate-500">inches (custom size)</span>
                </div>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Printed on">
                  <div className="grid grid-cols-2 gap-2">
                    {([1, 2] as const).map((pg) => (
                      <button
                        key={pg}
                        type="button"
                        onClick={() => set({ pages: pg })}
                        className={cn("h-12 rounded-lg border text-[15px] font-medium", l.pages === pg ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-300 bg-white text-slate-700")}
                      >
                        {pg === 1 ? "One side" : "Both sides"}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Paper" htmlFor="line-paper">
                  {cat?.print?.papers.length ? (
                    <Select id="line-paper" value={l.paperId ?? ""} onChange={(e) => set({ paperId: Number(e.target.value) || null })} className="h-12 text-base">
                      {cat.print.papers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <p className="text-sm text-amber-700">No paper stocks are set up for this item.</p>
                  )}
                </Field>
              </div>
            </>
          )}

          {l.kind === "sqft" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Width (inches)" htmlFor="line-w" required>
                <Input id="line-w" inputMode="decimal" value={l.widthIn ?? ""} onChange={(e) => set({ widthIn: Number(e.target.value) > 0 ? Number(e.target.value) : null })} className="h-12 text-base tabular" />
              </Field>
              <Field label="Height (inches)" htmlFor="line-h" required>
                <Input id="line-h" inputMode="decimal" value={l.heightIn ?? ""} onChange={(e) => set({ heightIn: Number(e.target.value) > 0 ? Number(e.target.value) : null })} className="h-12 text-base tabular" />
              </Field>
            </div>
          )}

          {l.kind === "manual" ? (
            <Field label="Price each" htmlFor="line-price" required hint={`${l.quantity.toLocaleString()} × ${money(l.unitCents)} = ${money(total)}`}>
              <MoneyInput
                id="line-price"
                value={priceText}
                onChange={(e) => {
                  setPriceText(e.target.value);
                  set({ unitCents: Math.max(0, parseMoney(e.target.value) ?? 0) });
                }}
                className="h-12 text-lg"
                autoFocus={!!cat}
              />
            </Field>
          ) : (
            <Field
              label="Price for this line"
              htmlFor="line-price"
              required
              hint={
                pricing ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" /> {l.kind === "print" ? "Estimating…" : "Checking your price list…"}
                  </span>
                ) : l.recommendedCents != null ? (
                  <>
                    {l.kind === "print" ? "Estimate" : "Price list"}: <strong>{money(l.recommendedCents)}</strong>
                    {l.kind === "print" && l.quantity > 1 && <> ({money(Math.round(l.recommendedCents / l.quantity))} each)</>}
                    {l.priceEdited && l.recommendedCents !== l.amountCents && (
                      <button
                        type="button"
                        className="ml-2 text-brand-600 underline"
                        onClick={() => {
                          set({ amountCents: l.recommendedCents!, priceEdited: false });
                          setPriceText(centsToInput(l.recommendedCents!));
                        }}
                      >
                        Use it
                      </button>
                    )}
                    {priceNote && <span className="block text-amber-700">{priceNote}</span>}
                    {runNote && <span className="block">{runNote}</span>}
                    {l.kind === "print" && <QuoteLink customerId={customerId} />}
                  </>
                ) : (
                  <>
                    {priceNote && <span className="block text-amber-700">{priceNote}</span>}
                    {l.kind === "print" && !pricing && <QuoteLink customerId={customerId} />}
                  </>
                )
              }
            >
              <MoneyInput
                id="line-price"
                value={priceText}
                onChange={(e) => {
                  setPriceText(e.target.value);
                  set({ amountCents: Math.max(0, parseMoney(e.target.value) ?? 0), priceEdited: true });
                }}
                className="h-12 text-lg"
              />
            </Field>
          )}

          <label className="flex cursor-pointer items-center gap-3 text-[15px] text-slate-800">
            <input type="checkbox" checked={l.taxable} onChange={(e) => set({ taxable: e.target.checked })} className="size-5 accent-brand-500" />
            Charge sales tax on this item
          </label>

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="text-lg font-semibold tabular text-slate-900">{money(total)}</p>
            <div className="flex gap-2">
              <Button size="lg" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" size="lg" variant="primary" disabled={!canSave}>
                {l.key ? <Pencil className="size-4" /> : <Plus className="size-5" />}
                {l.key ? "Save" : "Add to sale"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function QuoteLink({ customerId }: { customerId: number | null }) {
  return (
    <Link href={customerId ? `/quotes/new?customerId=${customerId}` : "/quotes/new"} className="mt-0.5 block text-brand-600 underline">
      Needs a full quote (ink colors, finishing, press)? Open the quote builder
    </Link>
  );
}
