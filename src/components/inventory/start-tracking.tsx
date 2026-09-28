"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { unitLabel } from "@/lib/inventory/math";
import { startTrackingAction } from "@/app/(app)/inventory/actions";
import { StockForm, StockSubmit } from "./stock-form";

export type UntrackedMaterial = { id: number; name: string; kind: string; unit: string; binLocation: string | null; reorderLevel: number | null; reorderQuantity: number | null };

const KIND_LABELS: Record<string, string> = { paper: "Paper", vinyl: "Vinyl & film", substrate: "Substrates", laminate: "Laminates", ink: "Ink & toner", other: "Other" };

/** "Start tracking" — pick a material the shop already has, enter today's count and when to reorder. */
export function StartTrackingButton({ materials, initialId, variant = "secondary" }: { materials: UntrackedMaterial[]; initialId?: number | null; variant?: "primary" | "secondary" }) {
  const [open, setOpen] = React.useState(!!initialId && materials.some((m) => m.id === initialId));
  const [id, setId] = React.useState(initialId && materials.some((m) => m.id === initialId) ? String(initialId) : "");
  const router = useRouter();
  const m = materials.find((x) => String(x.id) === id);
  const kinds = [...new Set(materials.map((x) => x.kind))];
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)} disabled={!materials.length} title={materials.length ? undefined : "Every material is already tracked."}>
        <Plus className="size-4" /> Start tracking
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Start tracking an item" description="Count what you have now. From then on, deliveries, jobs and counts keep the number right.">
          <StockForm
            action={startTrackingAction}
            successMessage="Now tracking"
            onSuccess={(r) => {
              setOpen(false);
              const newId = (r.data as { id?: number } | undefined)?.id;
              router.push(newId ? `/inventory/${newId}` : "/inventory");
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Item" htmlFor="tr-mat" required className="sm:col-span-2" hint="Paper comes from Settings → Paper & Stock; other materials from your pricing setup.">
                <Select id="tr-mat" name="materialId" required value={id} onChange={(e) => setId(e.target.value)}>
                  <option value="">Choose…</option>
                  {kinds.map((k) => (
                    <optgroup key={k} label={KIND_LABELS[k] ?? k}>
                      {materials
                        .filter((x) => x.kind === k)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </Select>
              </Field>
              <Field label={`On hand now${m ? ` (${unitLabel(m.unit)})` : ""}`} htmlFor="tr-qty" required hint={m?.unit === "sheet" ? "In sheets: a ream is usually 500, a carton 2,500." : undefined}>
                <Input id="tr-qty" name="onHand" inputMode="decimal" required placeholder="e.g. 2500" className="tabular" autoComplete="off" />
              </Field>
              <Field label="Where it's kept (bin)" htmlFor="tr-bin">
                <Input id="tr-bin" name="binLocation" key={`bin-${id}`} defaultValue={m?.binLocation ?? ""} placeholder="e.g. Munster · rack A2" />
              </Field>
              <Field label="Reorder when down to" htmlFor="tr-level" hint="Leave blank if you don't reorder it regularly.">
                <Input id="tr-level" name="reorderLevel" key={`lv-${id}`} inputMode="decimal" defaultValue={m?.reorderLevel ?? ""} placeholder="e.g. 1000" className="tabular" />
              </Field>
              <Field label="Usual order quantity" htmlFor="tr-rq">
                <Input id="tr-rq" name="reorderQuantity" key={`rq-${id}`} inputMode="decimal" defaultValue={m?.reorderQuantity ?? ""} placeholder="e.g. 5000" className="tabular" />
              </Field>
            </div>
            <p className="mt-4 text-sm text-slate-500">Open jobs that use it will reserve what they need right away.</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <StockSubmit>Start tracking</StockSubmit>
            </div>
          </StockForm>
        </DialogContent>
      </Dialog>
    </>
  );
}
