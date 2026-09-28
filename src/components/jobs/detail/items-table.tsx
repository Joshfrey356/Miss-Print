"use client";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, MoneyInput, Select, Textarea } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm";
import { useServerAction } from "@/components/use-action";
import { removeJobItem, saveJobItem } from "@/app/(app)/jobs/actions";
import { centsToInput, fmtSize, money, pct } from "@/lib/format";
import { marginOf } from "@/lib/pricing/engine";
import { runInfoOf, runSteps } from "@/lib/quotes/print-options";
import type { JobItem } from "@/lib/db/schema";

type Opt = { id: number; name: string };

export function ItemsTable({
  jobId,
  items,
  categories,
  canEdit,
  canSeeMoney,
  canSeeCost,
  totals,
}: {
  jobId: number;
  items: JobItem[];
  categories: Opt[];
  canEdit: boolean;
  canSeeMoney: boolean;
  canSeeCost: boolean;
  totals: { subtotalCents: number; taxCents: number; totalCents: number; estimatedCostCents: number };
}) {
  const [editing, setEditing] = useState<JobItem | "new" | null>(null);
  const [removing, setRemoving] = useState<JobItem | null>(null);
  const [pending, run] = useServerAction();

  return (
    <div>
      <div className="divide-y divide-slate-100">
        {items.map((i) => (
          <div key={i.id} className="flex gap-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-900">{i.description}</p>
              <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
                <Spec label="Qty" value={i.quantity.toLocaleString()} />
                <Spec label="Size" value={fmtSize(i.widthIn, i.heightIn)} />
                <Spec label="Material" value={i.material} />
                <Spec label="Finishing" value={i.finishing} />
                <Spec label="Color" value={i.colors} />
              </dl>
              {i.specs && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{i.specs}</p>}
              <RunBlock breakdown={i.pricingBreakdown} />
              {canSeeMoney && i.overrideReason && (
                <p className="mt-1 text-xs text-slate-500">
                  Price override: {i.overrideReason}
                  {i.recommendedCents !== i.priceCents && ` (recommended ${money(i.recommendedCents)})`}
                </p>
              )}
            </div>
            {canSeeMoney && (
              <div className="text-right">
                <p className="tabular font-semibold text-slate-900">{money(i.priceCents)}</p>
                {canSeeCost && i.estimatedCostCents > 0 && <p className="tabular text-xs text-slate-500">cost {money(i.estimatedCostCents)}</p>}
              </div>
            )}
            {canEdit && (
              <div className="flex shrink-0 items-start gap-1">
                <button onClick={() => setEditing(i)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Edit item">
                  <Pencil className="size-4" />
                </button>
                {items.length > 1 && (
                  <button onClick={() => setRemoving(i)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove item">
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4 border-t border-slate-100 pt-3">
        {canEdit ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> Add item
          </Button>
        ) : (
          <span />
        )}
        {canSeeMoney && (
          <dl className="tabular grid grid-cols-[auto_auto] gap-x-6 gap-y-0.5 text-right text-sm">
            <dt className="text-slate-500">Subtotal</dt>
            <dd>{money(totals.subtotalCents)}</dd>
            <dt className="text-slate-500">Tax</dt>
            <dd>{money(totals.taxCents)}</dd>
            <dt className="font-semibold text-slate-900">Total</dt>
            <dd className="font-semibold text-slate-900">{money(totals.totalCents)}</dd>
            {canSeeCost && totals.estimatedCostCents > 0 && (
              <>
                <dt className="text-slate-500">Quoted margin</dt>
                <dd className="text-slate-700">{pct(marginOf(totals.subtotalCents, totals.estimatedCostCents))}</dd>
              </>
            )}
          </dl>
        )}
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing !== null && (
          <DialogContent title={editing === "new" ? "Add item" : "Edit item"} wide>
            <ItemForm
              item={editing === "new" ? null : editing}
              categories={categories}
              canSeeMoney={canSeeMoney}
              canSeeCost={canSeeCost}
              pending={pending}
              onCancel={() => setEditing(null)}
              onSubmit={(fd) => run(() => saveJobItem(jobId, editing === "new" ? null : editing.id, fd), { onSuccess: () => setEditing(null) })}
            />
          </DialogContent>
        )}
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this item?"
        description={removing?.description}
        confirmLabel="Remove"
        onConfirm={() => { if (removing) run(() => removeJobItem(jobId, removing.id)); }}
      />
    </div>
  );
}

/** For print-estimated items: how to run it (press, paper, sheets…). Never shows prices. */
function RunBlock({ breakdown }: { breakdown: unknown }) {
  const run = runInfoOf(breakdown);
  if (!run) return null;
  return (
    <details className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" open>
      <summary className="cursor-pointer select-none font-medium text-slate-700">How to run it</summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {runSteps(run).map((s) => (
          <div key={s.label} className="contents">
            <dt className="text-slate-500">{s.label}</dt>
            <dd className="text-slate-800">{s.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function Spec({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-1">
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-700">{value}</dd>
    </div>
  );
}

function ItemForm({ item, categories, canSeeMoney, canSeeCost, pending, onSubmit, onCancel }: { item: JobItem | null; categories: Opt[]; canSeeMoney: boolean; canSeeCost: boolean; pending: boolean; onSubmit: (fd: FormData) => void; onCancel: () => void }) {
  return (
    <form action={onSubmit} className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Field label="Description" className="col-span-2 sm:col-span-4" required>
        <Input name="description" defaultValue={item?.description ?? ""} required autoFocus />
      </Field>
      <Field label="Category" className="col-span-2">
        <Select name="categoryId" defaultValue={item?.categoryId ?? ""}>
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Quantity">
        <Input name="quantity" type="number" min="1" defaultValue={item?.quantity ?? 1} />
      </Field>
      <div />
      <Field label="Width (in)">
        <Input name="widthIn" type="number" step="0.01" defaultValue={item?.widthIn ?? ""} />
      </Field>
      <Field label="Height (in)">
        <Input name="heightIn" type="number" step="0.01" defaultValue={item?.heightIn ?? ""} />
      </Field>
      <Field label="Material" className="col-span-2">
        <Input name="material" defaultValue={item?.material ?? ""} />
      </Field>
      <Field label="Finishing" className="col-span-2">
        <Input name="finishing" defaultValue={item?.finishing ?? ""} placeholder="Hem & grommets, laminate…" />
      </Field>
      <Field label="Colors" className="col-span-2">
        <Input name="colors" defaultValue={item?.colors ?? ""} placeholder="4/4, PMS 286…" />
      </Field>
      <Field label="Specifications" className="col-span-2 sm:col-span-4">
        <Textarea name="specs" defaultValue={item?.specs ?? ""} rows={2} />
      </Field>
      {canSeeMoney && (
        <Field label="Price (line total)">
          <MoneyInput name="price" defaultValue={centsToInput(item?.priceCents ?? 0)} />
        </Field>
      )}
      {canSeeCost && (
        <Field label="Estimated cost">
          <MoneyInput name="cost" defaultValue={centsToInput(item?.estimatedCostCents ?? 0)} />
        </Field>
      )}
      {canSeeMoney && (
        <div className="col-span-2 flex items-end pb-2">
          <input type="hidden" name="taxableField" value="1" />
          <Checkbox name="taxable" label="Taxable" defaultChecked={item?.taxable ?? true} />
        </div>
      )}
      <div className="col-span-2 flex justify-end gap-2 sm:col-span-4">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save item"}
        </Button>
      </div>
    </form>
  );
}
