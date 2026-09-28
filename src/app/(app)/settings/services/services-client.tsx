"use client";
import * as React from "react";
import { Plus, Scissors } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, MoneyInput, Select } from "@/components/ui/input";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import {
  OPERATION_BASIS_HINTS,
  OPERATION_BASIS_LABELS,
  OPERATION_CATEGORY_LABELS,
  RATE_UNIT,
  operationExample,
  type OperationBasis,
  type OperationCategory,
} from "@/lib/estimating/catalog-forms";
import { fmtMoney, fmtRate, parseCount, parseMoneyCents, parseRateCents, rateToInput } from "@/lib/estimating/parse";
import { centsToInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ActionForm, SaveButton } from "../_components/action-form";
import { RowActions, ShowInactiveLink } from "../paper/row-actions";
import { saveOperation, setOperationActive } from "./actions";

type Machine = { id: number; name: string };
export type Service = {
  id: number;
  name: string;
  category: OperationCategory;
  basis: OperationBasis;
  setupPriceCents: number;
  setupCostCents: number;
  ratePriceCents: number;
  rateCostCents: number;
  piecesPerHour: number | null;
  minimumCents: number;
  equipmentId: number | null;
  equipmentName: string | null;
  active: boolean;
};

const subCent = (b: OperationBasis) => b === "per_piece" || b === "per_sheet";

/** "$15.00 setup + $4.00 per 1,000 · minimum $25.00" */
function chargeSummary(s: Pick<Service, "basis" | "setupPriceCents" | "ratePriceCents" | "minimumCents" | "piecesPerHour">) {
  const parts: string[] = [];
  if (s.basis === "per_job") parts.push(`${fmtMoney(s.setupPriceCents + s.ratePriceCents)} per job`);
  else {
    if (s.setupPriceCents) parts.push(`${fmtMoney(s.setupPriceCents)} setup`);
    const rate = `${subCent(s.basis) ? fmtRate(s.ratePriceCents) : fmtMoney(s.ratePriceCents)} ${RATE_UNIT[s.basis]}`;
    parts.push(s.basis === "per_hour" && s.piecesPerHour ? `${rate} (${s.piecesPerHour.toLocaleString("en-US")} pieces/hr)` : rate);
  }
  const main = parts.join(" + ");
  return s.minimumCents ? `${main} · minimum ${fmtMoney(s.minimumCents)}` : main;
}

export function AddServiceButton({ equipment }: { equipment: Machine[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="primary" size="lg" onClick={() => setOpen(true)}>
        <Plus className="size-5" /> Add service
      </Button>
      {open && <ServiceDialog open onOpenChange={setOpen} equipment={equipment} />}
    </>
  );
}

export function ServiceList({ rows, inactiveCount, showAll, equipment }: { rows: Service[]; inactiveCount: number; showAll: boolean; equipment: Machine[] }) {
  const [editing, setEditing] = React.useState<Service | null>(null);
  const [adding, setAdding] = React.useState(false);
  return (
    <>
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={Scissors}
            title="No bindery or services yet"
            description="Add the work you do after printing — cutting is the one almost every job needs. Then folding, scoring, stitching, padding…"
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus className="size-4" /> Add cutting
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Service</Th>
                <Th className="hidden md:table-cell">How it&apos;s charged</Th>
                <Th className="hidden lg:table-cell">For example</Th>
                <Th aria-label="Actions" />
              </tr>
            </THead>
            <tbody>
              {rows.map((s) => (
                <Tr key={s.id} className={cn(!s.active && "bg-slate-50/60 text-slate-500")}>
                  <Td>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("font-medium", s.active ? "text-slate-900" : "text-slate-500")}>{s.name}</span>
                      <Badge>{OPERATION_CATEGORY_LABELS[s.category]}</Badge>
                      {!s.active && <Badge>Turned off</Badge>}
                    </div>
                    <p className="text-sm text-slate-500 md:hidden">{chargeSummary(s)}</p>
                    <p className="text-sm text-slate-500 lg:hidden">{operationExample(s)}</p>
                    {s.equipmentName && <p className="text-xs text-slate-500">On the {s.equipmentName}</p>}
                  </Td>
                  <Td className="hidden text-slate-700 md:table-cell">{chargeSummary(s)}</Td>
                  <Td className="hidden whitespace-nowrap text-slate-700 tabular lg:table-cell">{operationExample(s)}</Td>
                  <Td className="w-px">
                    <RowActions
                      name={s.name}
                      active={s.active}
                      onEdit={() => setEditing(s)}
                      setActive={(a) => setOperationActive(s.id, a)}
                      offWarning="It won't be offered on new estimates, and categories that include it by default will skip it. Old quotes and jobs keep it."
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Examples use 2,500 finished pieces printed on 500 press sheets.</p>
        <ShowInactiveLink showAll={showAll} inactiveCount={inactiveCount} basePath="/settings/services" />
      </div>
      {adding && <ServiceDialog open onOpenChange={setAdding} equipment={equipment} preset={{ name: "Cutting", basis: "per_1000" }} />}
      {editing && <ServiceDialog key={editing.id} open onOpenChange={(o) => !o && setEditing(null)} equipment={equipment} service={editing} />}
    </>
  );
}

function ServiceDialog({
  open,
  onOpenChange,
  equipment,
  service,
  preset,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  equipment: Machine[];
  service?: Service;
  preset?: { name: string; basis: OperationBasis };
}) {
  const s = service;
  const [basis, setBasis] = React.useState<OperationBasis>(s?.basis ?? preset?.basis ?? "per_1000");
  const rateIn = (c: number | undefined, b: OperationBasis) => (c == null || c === 0 ? "" : subCent(b) ? rateToInput(c) : centsToInput(c));
  const [f, setF] = React.useState({
    setupPrice: s ? centsToInput(s.basis === "per_job" ? s.setupPriceCents + s.ratePriceCents : s.setupPriceCents) : "",
    setupCost: s ? centsToInput(s.setupCostCents) : "",
    ratePrice: rateIn(s?.ratePriceCents, s?.basis ?? "per_1000"),
    rateCost: rateIn(s?.rateCostCents, s?.basis ?? "per_1000"),
    piecesPerHour: s?.piecesPerHour ? String(s.piecesPerHour) : "",
    minimum: s?.minimumCents ? centsToInput(s.minimumCents) : "",
  });
  const set = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }) });
  const num = (v: number | null) => (v == null || Number.isNaN(v) ? 0 : v);
  const rateCents = subCent(basis) ? num(parseRateCents(f.ratePrice)) : num(parseMoneyCents(f.ratePrice));
  const example = operationExample({
    basis,
    setupPriceCents: num(parseMoneyCents(f.setupPrice)),
    setupCostCents: 0,
    ratePriceCents: basis === "per_job" ? 0 : rateCents,
    rateCostCents: 0,
    piecesPerHour: basis === "per_hour" ? num(parseCount(f.piecesPerHour)) || null : null,
    minimumCents: num(parseMoneyCents(f.minimum)),
  });
  const unit = RATE_UNIT[basis];
  const RateBox = subCent(basis) ? Input : MoneyInput;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide title={s ? `Edit ${s.name}` : "Add a bindery or finishing service"} description="Priced on every estimate that uses it. Leave a cost blank if you don't track it.">
        <ActionForm action={saveOperation} successMessage={s ? "Service saved" : "Service added"} onSuccess={() => onOpenChange(false)}>
          {s && <input type="hidden" name="id" value={s.id} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="o-name" required>
              <Input id="o-name" name="name" required defaultValue={s?.name ?? preset?.name} placeholder="e.g. Folding" />
            </Field>
            <Field label="Category" htmlFor="o-cat">
              <Select id="o-cat" name="category" defaultValue={s?.category ?? "bindery"}>
                {Object.entries(OPERATION_CATEGORY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="How is it charged?" htmlFor="o-basis" required hint={OPERATION_BASIS_HINTS[basis]} className="sm:col-span-2">
              <Select id="o-basis" name="basis" value={basis} onChange={(e) => setBasis(e.target.value as OperationBasis)}>
                {Object.entries(OPERATION_BASIS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>

            {basis === "per_job" ? (
              <>
                <Field label="We charge per job" htmlFor="o-sp" required>
                  <MoneyInput id="o-sp" name="setupPrice" {...set("setupPrice")} placeholder="15.00" />
                </Field>
                <Field label="Costs us per job" htmlFor="o-sc">
                  <MoneyInput id="o-sc" name="setupCost" {...set("setupCost")} placeholder="7.00" />
                </Field>
              </>
            ) : (
              <>
                {basis === "per_hour" && (
                  <Field label="Pieces per hour" htmlFor="o-pph" required hint="How many finished pieces you get through in an hour." className="sm:col-span-2">
                    <Input id="o-pph" name="piecesPerHour" inputMode="numeric" {...set("piecesPerHour")} placeholder="2,000" className="tabular" />
                  </Field>
                )}
                <Field label={`We charge ${unit}`} htmlFor="o-rp" required hint={subCent(basis) ? "Fractions of a cent are fine: 3.5¢ or $0.035." : undefined}>
                  <RateBox id="o-rp" name="ratePrice" inputMode="decimal" {...set("ratePrice")} placeholder={basis === "per_piece" ? "$0.12" : basis === "per_sheet" ? "$0.75" : basis === "per_hour" ? "60.00" : "20.00"} className="tabular" />
                </Field>
                <Field label={`Costs us ${unit}`} htmlFor="o-rc">
                  <RateBox id="o-rc" name="rateCost" inputMode="decimal" {...set("rateCost")} className="tabular" />
                </Field>
                <Field label="Setup charge (once per job)" htmlFor="o-sp" hint="Setting up the machine. Leave blank if none.">
                  <MoneyInput id="o-sp" name="setupPrice" {...set("setupPrice")} placeholder="15.00" />
                </Field>
                <Field label="Setup cost to us" htmlFor="o-sc">
                  <MoneyInput id="o-sc" name="setupCost" {...set("setupCost")} />
                </Field>
              </>
            )}
            <Field label="Minimum charge" htmlFor="o-min" hint="Small jobs are charged at least this much.">
              <MoneyInput id="o-min" name="minimum" {...set("minimum")} placeholder="25.00" />
            </Field>
            <Field label="Done on (optional)" htmlFor="o-eq" hint="Which machine does this work.">
              <Select id="o-eq" name="equipmentId" defaultValue={s?.equipmentId ?? ""}>
                <option value="">—</option>
                {equipment.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-[15px] text-slate-700" aria-live="polite">
            <span className="text-slate-500">For example: </span>
            <b className="tabular">{example}</b>
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <SaveButton pendingText="Saving…">{s ? "Save service" : "Add service"}</SaveButton>
          </div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
