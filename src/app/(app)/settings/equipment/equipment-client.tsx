"use client";
import * as React from "react";
import { AlertTriangle, Plus, Printer } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox, Field, Input, MoneyInput, Select, Textarea } from "@/components/ui/input";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { EQUIPMENT_KIND_HINTS, EQUIPMENT_KIND_LABELS, isPress, type EquipmentKind } from "@/lib/estimating/catalog-forms";
import { fmtInches, fmtMoney, fmtRate, fmtSheet, parseRateCents, pctToInput, rateToInput } from "@/lib/estimating/parse";
import { centsToInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ActionForm, SaveButton } from "../_components/action-form";
import { SuffixInput } from "../_components/inputs";
import { RowActions, ShowInactiveLink } from "../paper/row-actions";
import { saveEquipment, setEquipmentActive } from "./actions";

type Loc = { id: number; name: string };
export type Machine = {
  id: number;
  name: string;
  kind: EquipmentKind;
  locationId: number | null;
  locationName: string | null;
  maxSheetWidthIn: number | null;
  maxSheetHeightIn: number | null;
  minSheetWidthIn: number | null;
  minSheetHeightIn: number | null;
  gripperIn: number;
  maxColors: number;
  perfecting: boolean;
  colorClickPriceCents: number | null;
  colorClickCostCents: number | null;
  bwClickPriceCents: number | null;
  bwClickCostCents: number | null;
  platePriceCents: number | null;
  plateCostCents: number | null;
  inkCostPerMCents: number | null;
  setupMinutes: number;
  sheetsPerHour: number | null;
  hourlyPriceCents: number | null;
  hourlyCostCents: number | null;
  setupSpoilageSheets: number;
  runSpoilagePct: number;
  notes: string | null;
  active: boolean;
};

const KIND_TONE: Record<EquipmentKind, Tone> = { digital: "blue", offset: "violet", wide_format: "teal", cutter: "gray", folder: "gray", bindery: "gray", other: "gray" };

/** One short line about what matters for estimating. */
function summary(m: Machine): string {
  const parts: string[] = [];
  const max = fmtSheet(m.maxSheetWidthIn, m.maxSheetHeightIn);
  if (m.kind === "digital") {
    if (max) parts.push(`up to ${max}`);
    if (m.colorClickPriceCents != null) parts.push(`color ${fmtRate(m.colorClickPriceCents)}/click`);
    if (m.bwClickPriceCents != null) parts.push(`B&W ${fmtRate(m.bwClickPriceCents)}/click`);
  } else if (m.kind === "offset") {
    if (max) parts.push(`up to ${max}`);
    parts.push(`${m.maxColors} color${m.maxColors === 1 ? "" : "s"}${m.perfecting ? ", perfecting" : ""}`);
    if (m.platePriceCents != null) parts.push(`plates ${fmtMoney(m.platePriceCents)}`);
    if (m.sheetsPerHour) parts.push(`${m.sheetsPerHour.toLocaleString("en-US")} sheets/hr`);
    if (m.hourlyPriceCents != null) parts.push(`${fmtMoney(m.hourlyPriceCents)}/hr`);
  } else if (m.hourlyPriceCents != null) parts.push(`${fmtMoney(m.hourlyPriceCents)}/hr`);
  return parts.join(" · ") || "—";
}

export function AddEquipmentButton({ locations }: { locations: Loc[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="primary" size="lg" onClick={() => setOpen(true)}>
        <Plus className="size-5" /> Add press or machine
      </Button>
      <EquipmentDialog open={open} onOpenChange={setOpen} locations={locations} />
    </>
  );
}

export function EquipmentList({
  rows,
  inactiveCount,
  activePresses,
  showAll,
  locations,
}: {
  rows: Machine[];
  inactiveCount: number;
  activePresses: number;
  showAll: boolean;
  locations: Loc[];
}) {
  const [editing, setEditing] = React.useState<Machine | null>(null);
  const [adding, setAdding] = React.useState<EquipmentKind | null>(null);
  return (
    <>
      {rows.length > 0 && activePresses === 0 && (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 px-4 py-3 text-[15px] text-amber-900">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          No digital or offset press is turned on, so printed work can&apos;t be estimated yet. Add your digital press to start estimating.
        </p>
      )}
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={Printer}
            title="No presses yet"
            description="Add your digital press to start estimating — its largest sheet and what you charge per click. Add an offset press too if you run one."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => setAdding("digital")}>
                  <Plus className="size-4" /> Add digital press
                </Button>
                <Button onClick={() => setAdding("offset")}>
                  <Plus className="size-4" /> Add offset press
                </Button>
              </div>
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Machine</Th>
                <Th className="hidden md:table-cell">For estimating</Th>
                <Th className="hidden lg:table-cell">Location</Th>
                <Th aria-label="Actions" />
              </tr>
            </THead>
            <tbody>
              {rows.map((m) => (
                <Tr key={m.id} className={cn(!m.active && "bg-slate-50/60 text-slate-500")}>
                  <Td>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("font-medium", m.active ? "text-slate-900" : "text-slate-500")}>{m.name}</span>
                      <Badge tone={KIND_TONE[m.kind]}>{EQUIPMENT_KIND_LABELS[m.kind]}</Badge>
                      {!m.active && <Badge>Turned off</Badge>}
                    </div>
                    <p className="text-sm text-slate-500 md:hidden">{summary(m)}</p>
                  </Td>
                  <Td className="hidden text-slate-700 md:table-cell">{summary(m)}</Td>
                  <Td className="hidden lg:table-cell">{m.locationName ?? "—"}</Td>
                  <Td className="w-px">
                    <RowActions
                      name={m.name}
                      active={m.active}
                      onEdit={() => setEditing(m)}
                      setActive={(a) => setEquipmentActive(m.id, a)}
                      offWarning={
                        isPress(m.kind)
                          ? "New estimates won't use this press. Old quotes and jobs keep their prices, and you can turn it back on any time."
                          : "It won't be offered for new work. You can turn it back on any time."
                      }
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">With no press picked, an estimate prices the job on every press that can run it and suggests the cheapest.</p>
        <ShowInactiveLink showAll={showAll} inactiveCount={inactiveCount} basePath="/settings/equipment" />
      </div>
      {adding && <EquipmentDialog open onOpenChange={(o) => !o && setAdding(null)} locations={locations} initialKind={adding} />}
      {editing && <EquipmentDialog key={editing.id} open onOpenChange={(o) => !o && setEditing(null)} locations={locations} machine={editing} />}
    </>
  );
}

/** Price box that accepts fractions of a cent and says back what it understood. */
function RateInput({ id, name, defaultCents, unit, placeholder }: { id: string; name: string; defaultCents: number | null | undefined; unit: string; placeholder?: string }) {
  const [v, setV] = React.useState(rateToInput(defaultCents));
  const cents = parseRateCents(v);
  return (
    <div>
      <Input id={id} name={name} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="tabular" />
      <p className={cn("mt-1 text-xs", cents != null && Number.isNaN(cents) ? "text-red-600" : "text-slate-500")}>
        {cents == null ? "\u00a0" : Number.isNaN(cents) ? "Type a price like $0.045 or 4.5¢" : `= ${fmtRate(cents)} ${unit}`}
      </p>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-slate-100 pt-4">
      <legend className="text-[15px] font-semibold text-slate-900">{title}</legend>
      {hint && <p className="mb-3 text-sm text-slate-500">{hint}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function EquipmentDialog({
  open,
  onOpenChange,
  locations,
  machine,
  initialKind,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  locations: Loc[];
  machine?: Machine;
  initialKind?: EquipmentKind;
}) {
  const [kind, setKind] = React.useState<EquipmentKind>(machine?.kind ?? initialKind ?? "digital");
  const m = machine;
  const sheet = (w: number | null | undefined, h: number | null | undefined) => fmtSheet(w, h).replace(" × ", " x ");
  const isDigital = kind === "digital";
  const isOffset = kind === "offset";
  // Starting values for a new press, so the owner edits rather than invents numbers.
  const d = m ?? (isOffset ? { setupMinutes: 15, setupSpoilageSheets: 100, runSpoilagePct: 0.03, gripperIn: 0.375, maxColors: 4 } : { setupMinutes: 5, setupSpoilageSheets: 10, runSpoilagePct: 0.02, gripperIn: 0.2, maxColors: 4 });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide title={m ? `Edit ${m.name}` : "Add a press or machine"} description={EQUIPMENT_KIND_HINTS[kind]}>
        <ActionForm action={saveEquipment} successMessage={m ? "Saved" : "Added"} onSuccess={() => onOpenChange(false)}>
          {m && <input type="hidden" name="id" value={m.id} />}
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="What kind of machine?" htmlFor="e-kind" required>
                <Select id="e-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as EquipmentKind)}>
                  {Object.entries(EQUIPMENT_KIND_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Name" htmlFor="e-name" required hint="What your team calls it.">
                <Input id="e-name" name="name" required defaultValue={m?.name} placeholder={isOffset ? "e.g. Heidelberg GTO 52" : isDigital ? "e.g. Konica C4080" : "e.g. Challenge 305 cutter"} />
              </Field>
              <Field label="Location" htmlFor="e-loc">
                <Select id="e-loc" name="locationId" defaultValue={m?.locationId ?? ""}>
                  <option value="">—</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div key={kind} className="space-y-5">
            {(isDigital || isOffset) && (
              <Section title="Sheets" hint="Paper bigger than the largest sheet is cut down to fit before printing.">
                <Field label="Largest sheet (inches)" htmlFor="e-max" required hint={isOffset ? "e.g. 14 x 20, 20 x 28." : "e.g. 13 x 19 on most digital presses."}>
                  <Input id="e-max" name="maxSheet" required defaultValue={sheet(m?.maxSheetWidthIn, m?.maxSheetHeightIn)} placeholder={isOffset ? "14 x 20" : "13 x 19"} />
                </Field>
                <Field label="Smallest sheet (inches)" htmlFor="e-min" hint="Optional. We won't cut paper smaller than this for the press.">
                  <Input id="e-min" name="minSheet" defaultValue={sheet(m?.minSheetWidthIn, m?.minSheetHeightIn)} placeholder="8.5 x 11" />
                </Field>
                <Field label="Unprintable edge (inches)" htmlFor="e-grip" hint={isOffset ? 'The gripper edge the press can\'t print on. Usually 3/8" (0.375).' : 'Blank margin on each edge. Usually about 0.2".'}>
                  <SuffixInput id="e-grip" name="gripperIn" suffix="in" defaultValue={fmtInches(d.gripperIn ?? 0.25)} />
                </Field>
                {isOffset && (
                  <Field label="Colors per pass" htmlFor="e-colors" required hint="1 = one-color press, 2 = two-color, 4 = four-color (CMYK).">
                    <Input id="e-colors" name="maxColors" inputMode="numeric" defaultValue={d.maxColors ?? 4} className="tabular" />
                  </Field>
                )}
                {isOffset && (
                  <Checkbox
                    name="perfecting"
                    defaultChecked={m?.perfecting ?? false}
                    label="Prints both sides in one pass (perfector)"
                    hint="Most small presses don't — two-sided work goes through twice."
                    className="sm:col-span-2"
                  />
                )}
              </Section>
            )}

            {isDigital && (
              <Section title="Click charges" hint="Per printed side of one press sheet: a 12×18 sheet printed both sides is 2 clicks. Fractions of a cent are fine — type 4.5¢ or $0.045.">
                <Field label="Color — we charge" htmlFor="e-ccp" hint="What goes on the estimate.">
                  <RateInput id="e-ccp" name="colorClickPrice" defaultCents={m?.colorClickPriceCents} unit="per color click" placeholder="$0.30" />
                </Field>
                <Field label="Color — costs us" htmlFor="e-ccc" hint="Your click charge from the lease or service contract, plus toner.">
                  <RateInput id="e-ccc" name="colorClickCost" defaultCents={m?.colorClickCostCents} unit="per color click" placeholder="4.5¢" />
                </Field>
                <Field label="Black & white — we charge" htmlFor="e-bcp">
                  <RateInput id="e-bcp" name="bwClickPrice" defaultCents={m?.bwClickPriceCents} unit="per black click" placeholder="$0.08" />
                </Field>
                <Field label="Black & white — costs us" htmlFor="e-bcc">
                  <RateInput id="e-bcc" name="bwClickCost" defaultCents={m?.bwClickCostCents} unit="per black click" placeholder="1¢" />
                </Field>
              </Section>
            )}

            {isOffset && (
              <Section title="Plates & ink" hint="Each color on each side needs its own plate: full color one side (4/0) = 4 plates, both sides (4/4) = 8.">
                <Field label="Plate — we charge" htmlFor="e-pp">
                  <MoneyInput id="e-pp" name="platePrice" defaultValue={centsToInput(m?.platePriceCents)} placeholder="25.00" />
                </Field>
                <Field label="Plate — costs us" htmlFor="e-pc">
                  <MoneyInput id="e-pc" name="plateCost" defaultValue={centsToInput(m?.plateCostCents)} placeholder="12.00" />
                </Field>
                <Field label="Ink cost per 1,000 sheets, per color" htmlFor="e-ink" hint="What ink costs you for 1,000 sheets of one color. It's marked up like paper.">
                  <MoneyInput id="e-ink" name="inkCostPerM" defaultValue={centsToInput(m?.inkCostPerMCents)} placeholder="3.00" />
                </Field>
              </Section>
            )}

            {(isDigital || isOffset) && (
              <Section title="Setup, speed & spoilage">
                <Field
                  label={isOffset ? "Make-ready minutes per plate" : "Setup minutes per job"}
                  htmlFor="e-setup"
                  hint={isOffset ? "Hanging a plate, inking up and getting color right. A 4-color job takes 4 × this." : "Loading paper and running a test sheet. Charged at the hourly rate."}
                >
                  <SuffixInput id="e-setup" name="setupMinutes" suffix="min" defaultValue={String(d.setupMinutes ?? 0)} />
                </Field>
                <Field label="Speed" htmlFor="e-sph" required={isOffset} hint={isOffset ? "Sheets an hour once it's running." : "Sheets an hour. Used for our cost of press time."}>
                  <SuffixInput id="e-sph" name="sheetsPerHour" suffix="sheets/hr" defaultValue={m?.sheetsPerHour ?? ""} placeholder={isOffset ? "6,000" : "3,600"} className="pr-20" />
                </Field>
                <Field label="Setup spoilage" htmlFor="e-sps" hint={isOffset ? "Sheets wasted getting each pass up to color." : "Sheets wasted on test prints, per job."}>
                  <SuffixInput id="e-sps" name="setupSpoilageSheets" suffix="sheets" defaultValue={String(d.setupSpoilageSheets ?? 0)} className="pr-16" />
                </Field>
                <Field label="Running spoilage" htmlFor="e-rsp" hint="Extra sheets for jams and bad sheets during the run, as a share of the job.">
                  <SuffixInput id="e-rsp" name="runSpoilagePct" suffix="%" defaultValue={pctToInput(d.runSpoilagePct ?? 0)} />
                </Field>
              </Section>
            )}

            <Section
              title="Machine time"
              hint={
                isOffset
                  ? "Press time (make-ready + running) is charged at this rate."
                  : isDigital
                    ? "The setup time above is charged at this rate; clicks cover the running."
                    : "Used when a bindery service linked to this machine is charged by the hour."
              }
            >
              <Field label="Hourly rate we charge" htmlFor="e-hp" required={isOffset}>
                <MoneyInput id="e-hp" name="hourlyPrice" defaultValue={centsToInput(m?.hourlyPriceCents)} placeholder={isOffset ? "110.00" : "60.00"} />
              </Field>
              <Field label="Hourly cost to us" htmlFor="e-hc" hint="Operator wage + machine running costs.">
                <MoneyInput id="e-hc" name="hourlyCost" defaultValue={centsToInput(m?.hourlyCostCents)} placeholder={isOffset ? "65.00" : "35.00"} />
              </Field>
            </Section>

            </div>

            <Field label="Notes" htmlFor="e-notes">
              <Textarea id="e-notes" name="notes" rows={2} defaultValue={m?.notes ?? ""} placeholder="Service contract, quirks, what it's best for…" />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <SaveButton pendingText="Saving…">{m ? "Save" : `Add ${EQUIPMENT_KIND_LABELS[kind].toLowerCase()}`}</SaveButton>
          </div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
