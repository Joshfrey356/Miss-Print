"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, MinusCircle, PackagePlus, Settings2, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm";
import { useJobNo } from "@/components/shop-context";
import { useServerAction } from "@/components/use-action";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { fmtDelta, fmtQty, parseQty, qtyWithUnit, roundQty, unitLabel } from "@/lib/inventory/math";
import { adjustAction, countAction, receiveAction, saveStockSettings, stopTrackingAction, takeFromStockAction } from "@/app/(app)/inventory/actions";
import { StockForm, StockSubmit } from "./stock-form";

export type StockItemInfo = {
  id: number;
  name: string;
  unit: string;
  onHand: number;
  reorderLevel: number | null;
  reorderQuantity: number | null;
  binLocation: string | null;
};
export type OpenPoLine = { lineId: number; number: number; remaining: number; expectedOn: string | null; vendorName: string };
export type PickJob = { id: number; number: number; title: string };
export type ReservedJob = PickJob & { quantity: number };

type Kind = "receive" | "use" | "adjust" | "count" | "settings";

/**
 * Receive / Use / Adjust / Count buttons with their dialogs for one stock item. `big` = the phone
 * view after scanning a shelf label: two large buttons first.
 */
export function StockActions({
  item,
  poLines,
  jobs,
  reservedFor,
  big,
  showSettings = true,
}: {
  item: StockItemInfo;
  poLines: OpenPoLine[];
  jobs: PickJob[];
  reservedFor: ReservedJob[];
  big?: boolean;
  showSettings?: boolean;
}) {
  const [open, setOpen] = React.useState<Kind | null>(null);
  const router = useRouter();
  const close = () => {
    setOpen(null);
    router.refresh();
  };
  const dialogs = (
    <>
      <ReceiveDialog open={open === "receive"} onOpenChange={(o) => setOpen(o ? "receive" : null)} item={item} poLines={poLines} onDone={close} />
      <UseDialog open={open === "use"} onOpenChange={(o) => setOpen(o ? "use" : null)} item={item} jobs={jobs} reservedFor={reservedFor} onDone={close} />
      <AdjustDialog open={open === "adjust"} onOpenChange={(o) => setOpen(o ? "adjust" : null)} item={item} onDone={close} />
      <CountDialog open={open === "count"} onOpenChange={(o) => setOpen(o ? "count" : null)} item={item} onDone={close} />
      {showSettings && <SettingsDialog open={open === "settings"} onOpenChange={(o) => setOpen(o ? "settings" : null)} item={item} onDone={close} />}
    </>
  );
  if (big)
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setOpen("receive")}
            className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 text-lg font-semibold text-white shadow-sm active:bg-emerald-700"
          >
            <PackagePlus className="size-7" /> Receive
          </button>
          <button
            onClick={() => setOpen("use")}
            className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-2xl bg-brand-500 text-lg font-semibold text-white shadow-sm active:bg-brand-600"
          >
            <MinusCircle className="size-7" /> Use
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Button size="lg" onClick={() => setOpen("count")}>
            <ClipboardCheck className="size-5" /> Count
          </Button>
          <Button size="lg" onClick={() => setOpen("adjust")}>
            <SlidersHorizontal className="size-5" /> Adjust
          </Button>
        </div>
        {dialogs}
      </div>
    );
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="success" onClick={() => setOpen("receive")}>
        <PackagePlus className="size-4" /> Receive
      </Button>
      <Button variant="primary" onClick={() => setOpen("use")}>
        <MinusCircle className="size-4" /> Use on a job
      </Button>
      <Button onClick={() => setOpen("count")}>
        <ClipboardCheck className="size-4" /> Count
      </Button>
      <Button onClick={() => setOpen("adjust")}>
        <SlidersHorizontal className="size-4" /> Adjust
      </Button>
      {showSettings && (
        <Button variant="ghost" onClick={() => setOpen("settings")} aria-label="Reorder settings">
          <Settings2 className="size-4" /> Settings
        </Button>
      )}
      {dialogs}
    </div>
  );
}

type DialogProps = { open: boolean; onOpenChange: (o: boolean) => void; item: StockItemInfo; onDone: () => void };

function QtyInput({ id, name, unit, defaultValue, value, onChange, autoFocus }: { id: string; name: string; unit: string; defaultValue?: string; value?: string; onChange?: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        inputMode="decimal"
        required
        autoFocus={autoFocus}
        autoComplete="off"
        defaultValue={defaultValue}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className="h-12 pr-20 text-lg tabular"
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-500">{unitLabel(unit)}</span>
    </div>
  );
}

function Actions({ onCancel, label, pending }: { onCancel: () => void; label: string; pending?: string }) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <Button onClick={onCancel}>Cancel</Button>
      <StockSubmit size="lg" pendingText={pending ?? "Saving…"}>
        {label}
      </StockSubmit>
    </div>
  );
}

function ReceiveDialog({ open, onOpenChange, item, poLines, onDone }: DialogProps & { poLines: OpenPoLine[] }) {
  const single = poLines.length === 1 ? poLines[0]! : null;
  const [lineId, setLineId] = React.useState<string>(single ? String(single.lineId) : "");
  const [qty, setQty] = React.useState(single ? fmtQty(single.remaining).replace(/,/g, "") : "");
  const line = poLines.find((l) => String(l.lineId) === lineId);
  const n = parseQty(qty);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Receive ${item.name}`} description={`${qtyWithUnit(item.onHand, item.unit)} on hand now.`}>
        <StockForm action={receiveAction} successMessage="Received" onSuccess={onDone}>
          <input type="hidden" name="materialId" value={item.id} />
          <div className="space-y-4">
            {poLines.length > 0 && (
              <Field label="From purchase order" htmlFor="rc-po" hint="Receiving against a PO keeps the order up to date.">
                <Select
                  id="rc-po"
                  name="poLineId"
                  value={lineId}
                  onChange={(e) => {
                    setLineId(e.target.value);
                    const l = poLines.find((x) => String(x.lineId) === e.target.value);
                    if (l) setQty(String(l.remaining));
                  }}
                >
                  <option value="">Not on a purchase order</option>
                  {poLines.map((l) => (
                    <option key={l.lineId} value={l.lineId}>
                      PO-{l.number} · {l.vendorName} · {fmtQty(l.remaining)} still to come{l.expectedOn ? ` · due ${fmtDate(l.expectedOn)}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="How many came in?" htmlFor="rc-qty">
              <QtyInput id="rc-qty" name="quantity" unit={item.unit} value={qty} onChange={setQty} autoFocus />
            </Field>
            {line && n != null && n > line.remaining && (
              <p className="text-sm text-amber-700">That&apos;s more than the {fmtQty(line.remaining)} still to come on PO-{line.number} — fine if the vendor sent extra.</p>
            )}
            {n != null && n > 0 && (
              <p className="text-[15px] text-slate-600">
                On hand after: <b className="tabular text-slate-900">{qtyWithUnit(roundQty(item.onHand + n), item.unit)}</b>
              </p>
            )}
            <Field label="Note (optional)" htmlFor="rc-note">
              <Input id="rc-note" name="note" placeholder="Packing slip #, who delivered…" />
            </Field>
          </div>
          <Actions onCancel={() => onOpenChange(false)} label="Receive" />
        </StockForm>
      </DialogContent>
    </Dialog>
  );
}

function UseDialog({ open, onOpenChange, item, jobs, reservedFor, onDone }: DialogProps & { jobs: PickJob[]; reservedFor: ReservedJob[] }) {
  const jobNo = useJobNo();
  const [jobId, setJobId] = React.useState(reservedFor.length === 1 ? String(reservedFor[0]!.id) : "");
  const [qty, setQty] = React.useState(reservedFor.length === 1 ? String(reservedFor[0]!.quantity) : "");
  const reservedIds = new Set(reservedFor.map((j) => j.id));
  const others = jobs.filter((j) => !reservedIds.has(j.id));
  const n = parseQty(qty);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Use ${item.name}`} description={`${qtyWithUnit(item.onHand, item.unit)} on hand now.`}>
        <StockForm action={takeFromStockAction} successMessage="Recorded" onSuccess={onDone}>
          <input type="hidden" name="materialId" value={item.id} />
          <div className="space-y-4">
            {reservedFor.length > 0 && (
              <div>
                <p className="mb-1.5 text-sm font-medium text-slate-700">Reserved for</p>
                <div className="flex flex-wrap gap-2">
                  {reservedFor.map((j) => (
                    <button
                      type="button"
                      key={j.id}
                      onClick={() => {
                        setJobId(String(j.id));
                        setQty(String(j.quantity));
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-left text-sm",
                        String(j.id) === jobId ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                      )}
                    >
                      <b>{jobNo(j.number)}</b> · {fmtQty(j.quantity)}
                      <span className="block max-w-56 truncate text-xs text-slate-500">{j.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Field label="Job" htmlFor="use-job" hint="Charged to the job's cost. Leave empty for shop use or waste.">
              <Select id="use-job" name="jobId" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">No job (shop use, samples, waste)</option>
                {reservedFor.length > 0 && (
                  <optgroup label="Reserved this item">
                    {reservedFor.map((j) => (
                      <option key={j.id} value={j.id}>
                        {jobNo(j.number)} · {j.title}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Open jobs">
                  {others.map((j) => (
                    <option key={j.id} value={j.id}>
                      {jobNo(j.number)} · {j.title}
                    </option>
                  ))}
                </optgroup>
              </Select>
            </Field>
            <Field label="How much was used?" htmlFor="use-qty">
              <QtyInput id="use-qty" name="quantity" unit={item.unit} value={qty} onChange={setQty} autoFocus={!reservedFor.length} />
            </Field>
            {n != null && n > 0 && (
              <p className={cn("text-[15px]", item.onHand - n < 0 ? "font-medium text-red-700" : "text-slate-600")}>
                On hand after: <b className="tabular">{qtyWithUnit(roundQty(item.onHand - n), item.unit)}</b>
              </p>
            )}
            <Field label="Note (optional)" htmlFor="use-note">
              <Input id="use-note" name="note" placeholder="e.g. reprint after a jam" />
            </Field>
          </div>
          <Actions onCancel={() => onOpenChange(false)} label="Take from stock" />
        </StockForm>
      </DialogContent>
    </Dialog>
  );
}

const REASONS = ["Damaged", "Spoilage / waste", "Found more", "Returned to vendor", "Sample"];

function AdjustDialog({ open, onOpenChange, item, onDone }: DialogProps) {
  const [direction, setDirection] = React.useState<"add" | "remove">("remove");
  const [reason, setReason] = React.useState("");
  const [qty, setQty] = React.useState("");
  const n = parseQty(qty);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Adjust ${item.name}`} description="For corrections: damage, waste, found stock. To record a full count, use Count instead.">
        <StockForm action={adjustAction} successMessage="Adjusted" onSuccess={onDone}>
          <input type="hidden" name="materialId" value={item.id} />
          <input type="hidden" name="direction" value={direction} />
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Add or take away">
              {(["remove", "add"] as const).map((d) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={direction === d}
                  key={d}
                  onClick={() => setDirection(d)}
                  className={cn("h-11 rounded-lg border text-[15px] font-medium", direction === d ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-300 bg-white text-slate-700")}
                >
                  {d === "remove" ? "− Take away" : "+ Add"}
                </button>
              ))}
            </div>
            <Field label="How much?" htmlFor="adj-qty">
              <QtyInput id="adj-qty" name="quantity" unit={item.unit} value={qty} onChange={setQty} autoFocus />
            </Field>
            <Field label="Why?" htmlFor="adj-reason" required>
              <Input id="adj-reason" name="reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. water damage on the bottom ream" />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {REASONS.map((r) => (
                  <button type="button" key={r} onClick={() => setReason(r)} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100">
                    {r}
                  </button>
                ))}
              </div>
            </Field>
            {n != null && n > 0 && (
              <p className="text-[15px] text-slate-600">
                On hand after: <b className="tabular text-slate-900">{qtyWithUnit(roundQty(item.onHand + (direction === "add" ? n : -n)), item.unit)}</b>
              </p>
            )}
          </div>
          <Actions onCancel={() => onOpenChange(false)} label="Save adjustment" />
        </StockForm>
      </DialogContent>
    </Dialog>
  );
}

function CountDialog({ open, onOpenChange, item, onDone }: DialogProps) {
  const [qty, setQty] = React.useState("");
  const n = parseQty(qty);
  const diff = n != null ? roundQty(n - item.onHand) : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Count ${item.name}`} description={`Count what's on the shelf${item.binLocation ? ` (${item.binLocation})` : ""} and enter the total.`}>
        <StockForm action={countAction} successMessage="Count saved" onSuccess={onDone}>
          <input type="hidden" name="materialId" value={item.id} />
          <div className="space-y-4">
            <Field label="How many are there?" htmlFor="cnt-qty">
              <QtyInput id="cnt-qty" name="counted" unit={item.unit} value={qty} onChange={setQty} autoFocus />
            </Field>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[15px] text-slate-700" aria-live="polite">
              The system says <b className="tabular">{qtyWithUnit(item.onHand, item.unit)}</b>.
              {diff != null && (
                <>
                  {" "}
                  {diff === 0 ? (
                    "Your count matches."
                  ) : (
                    <>
                      Your count is <b className={cn("tabular", diff < 0 ? "text-red-700" : "text-emerald-700")}>{fmtDelta(diff)}</b> different; it will be recorded.
                    </>
                  )}
                </>
              )}
            </p>
            <Field label="Note (optional)" htmlFor="cnt-note">
              <Input id="cnt-note" name="note" placeholder="e.g. monthly count" />
            </Field>
          </div>
          <Actions onCancel={() => onOpenChange(false)} label="Save count" />
        </StockForm>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({ open, onOpenChange, item, onDone }: DialogProps) {
  const [stopping, setStopping] = React.useState(false);
  const [, run] = useServerAction();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Reorder settings · ${item.name}`}>
        <StockForm action={saveStockSettings} successMessage="Saved" onSuccess={onDone}>
          <input type="hidden" name="materialId" value={item.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reorder when available is at" htmlFor="st-level" hint="Shows as Low and appears in Suggested orders.">
              <Input id="st-level" name="reorderLevel" inputMode="decimal" defaultValue={item.reorderLevel ?? ""} placeholder="e.g. 1000" className="tabular" />
            </Field>
            <Field label="Usual order quantity" htmlFor="st-qty" hint={item.unit === "sheet" ? "Sheets — rounded up to reams of 500." : undefined}>
              <Input id="st-qty" name="reorderQuantity" inputMode="decimal" defaultValue={item.reorderQuantity ?? ""} placeholder="e.g. 5000" className="tabular" />
            </Field>
            <Field label="Where it's kept (bin)" htmlFor="st-bin" className="sm:col-span-2">
              <Input id="st-bin" name="binLocation" defaultValue={item.binLocation ?? ""} placeholder="e.g. Munster · paper rack A2" />
            </Field>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" className="text-red-700" onClick={() => setStopping(true)}>
              Stop tracking…
            </Button>
            <div className="flex gap-2">
              <Button onClick={() => onOpenChange(false)}>Cancel</Button>
              <StockSubmit>Save</StockSubmit>
            </div>
          </div>
        </StockForm>
        <ConfirmDialog
          open={stopping}
          onOpenChange={setStopping}
          title={`Stop tracking ${item.name}?`}
          description="Its stock won't be counted or reserved for jobs any more. The history is kept, and you can start tracking again any time."
          confirmLabel="Stop tracking"
          onConfirm={() =>
            run(() => stopTrackingAction(item.id), {
              onSuccess: () => {
                onOpenChange(false);
                router.push("/inventory");
              },
            })
          }
        />
      </DialogContent>
    </Dialog>
  );
}
