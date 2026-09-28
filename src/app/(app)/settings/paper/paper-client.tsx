"use client";
import * as React from "react";
import { AlertTriangle, Layers, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, MoneyInput, Select } from "@/components/ui/input";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { sheetPrices } from "@/lib/estimating/catalog-forms";
import { fmtMoney, fmtSheet, parseMoneyCents, parsePct, pctToInput } from "@/lib/estimating/parse";
import { centsToInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ActionForm, SaveButton } from "../_components/action-form";
import { SuffixInput } from "../_components/inputs";
import { savePaper, setPaperActive } from "./actions";
import { RowActions, ShowInactiveLink } from "./row-actions";

type Vendor = { id: number; name: string };
type Paper = {
  id: number;
  name: string;
  weight: string | null;
  sheetWidthIn: number | null;
  sheetHeightIn: number | null;
  costPerMCents: number | null;
  markupPct: number | null;
  vendorId: number | null;
  vendorName: string | null;
  sku: string | null;
  active: boolean;
};

/** Default paper markup when neither the paper nor the category sets one (see print.ts). */
const DEFAULT_MARKUP = 0.3;

/** 8 → "8.0¢", 10.4 → "10.4¢", 0.45 → "0.45¢", 120 → "$1.20" */
const perSheet = (c: number) => (c < 100 ? `${c.toFixed(c < 1 ? 2 : 1)}¢` : fmtMoney(Math.round(c)));

export function AddPaperButton({ vendors }: { vendors: Vendor[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="primary" size="lg" onClick={() => setOpen(true)}>
        <Plus className="size-5" /> Add paper
      </Button>
      <PaperDialog open={open} onOpenChange={setOpen} vendors={vendors} />
    </>
  );
}

export function PaperList({ rows, inactiveCount, showAll, vendors }: { rows: Paper[]; inactiveCount: number; showAll: boolean; vendors: Vendor[] }) {
  const [editing, setEditing] = React.useState<Paper | null>(null);
  const [adding, setAdding] = React.useState(false);
  return (
    <>
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={Layers}
            title={showAll ? "No paper stocks yet" : "No paper in use"}
            description="Add the paper you print on most — its sheet size and what 1,000 sheets cost you — to start estimating printed work."
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus className="size-4" /> Add your first paper
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Paper</Th>
                <Th className="hidden md:table-cell">Sheet size</Th>
                <Th className="hidden text-right sm:table-cell">Cost per 1,000</Th>
                <Th className="hidden text-right lg:table-cell">Per sheet</Th>
                <Th className="hidden lg:table-cell">Markup</Th>
                <Th className="hidden xl:table-cell">Vendor</Th>
                <Th aria-label="Actions" />
              </tr>
            </THead>
            <tbody>
              {rows.map((p) => {
                const size = fmtSheet(p.sheetWidthIn, p.sheetHeightIn);
                const ready = Boolean(size && p.costPerMCents != null);
                const prices = p.costPerMCents != null ? sheetPrices(p.costPerMCents, p.markupPct, DEFAULT_MARKUP) : null;
                return (
                  <Tr key={p.id} className={cn(!p.active && "bg-slate-50/60 text-slate-500")}>
                    <Td>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("font-medium", p.active ? "text-slate-900" : "text-slate-500")}>{p.name}</span>
                        {!p.active && <Badge>Turned off</Badge>}
                      </div>
                      <p className="text-sm text-slate-500">
                        {p.weight}
                        {size && (
                          <span className="md:hidden">
                            {p.weight ? " · " : ""}
                            {size}
                          </span>
                        )}
                        {p.costPerMCents != null && <span className="sm:hidden"> · {fmtMoney(p.costPerMCents)}/1,000</span>}
                      </p>
                      {!ready && (
                        <p className="mt-1 flex items-center gap-1.5 text-sm text-amber-700">
                          <AlertTriangle className="size-4 shrink-0" /> Add the sheet size and cost per 1,000 to use it in estimates.
                        </p>
                      )}
                    </Td>
                    <Td className="hidden whitespace-nowrap tabular md:table-cell">{size || "—"}</Td>
                    <Td className="hidden text-right whitespace-nowrap tabular sm:table-cell">{p.costPerMCents != null ? fmtMoney(p.costPerMCents) : "—"}</Td>
                    <Td className="hidden text-right whitespace-nowrap tabular lg:table-cell">
                      {prices ? (
                        <>
                          <span className="text-slate-900">{perSheet(prices.pricePerSheetCents)}</span>
                          <span className="block text-xs text-slate-500">costs us {perSheet(prices.costPerSheetCents)}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="hidden whitespace-nowrap lg:table-cell">
                      {p.markupPct != null ? `${pctToInput(p.markupPct)}%` : <span className="text-slate-500">Category default</span>}
                    </Td>
                    <Td className="hidden xl:table-cell">
                      {p.vendorName ?? "—"}
                      {p.sku && <span className="block text-xs text-slate-500">SKU {p.sku}</span>}
                    </Td>
                    <Td className="w-px">
                      <RowActions
                        name={p.name}
                        active={p.active}
                        onEdit={() => setEditing(p)}
                        setActive={(a) => setPaperActive(p.id, a)}
                        offWarning="It won't be offered on new estimates. Old quotes and jobs keep it, and you can turn it back on any time."
                      />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Per sheet = cost per 1,000 ÷ 1,000, plus markup. Leave markup blank to use each pricing category&apos;s paper markup (usually {Math.round(DEFAULT_MARKUP * 100)}%).
        </p>
        <ShowInactiveLink showAll={showAll} inactiveCount={inactiveCount} basePath="/settings/paper" />
      </div>
      <PaperDialog open={adding} onOpenChange={setAdding} vendors={vendors} />
      {editing && <PaperDialog key={editing.id} open onOpenChange={(o) => !o && setEditing(null)} vendors={vendors} paper={editing} />}
    </>
  );
}

function PaperDialog({ open, onOpenChange, vendors, paper }: { open: boolean; onOpenChange: (o: boolean) => void; vendors: Vendor[]; paper?: Paper }) {
  const [cost, setCost] = React.useState(centsToInput(paper?.costPerMCents));
  const [markup, setMarkup] = React.useState(pctToInput(paper?.markupPct));
  const costCents = parseMoneyCents(cost);
  const markupPct = parsePct(markup);
  const preview = costCents != null && !Number.isNaN(costCents) && !Number.isNaN(markupPct ?? 0) ? sheetPrices(costCents, markupPct, DEFAULT_MARKUP) : null;
  const vendorOptions = paper?.vendorId && !vendors.some((v) => v.id === paper.vendorId) ? [...vendors, { id: paper.vendorId, name: paper.vendorName ?? "Current vendor" }] : vendors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide title={paper ? `Edit ${paper.name}` : "Add a paper stock"} description="Enter the sheet size you buy it in. We'll cut it down to fit the press when it's bigger.">
        <ActionForm action={savePaper} successMessage={paper ? "Paper saved" : "Paper added"} onSuccess={() => onOpenChange(false)} resetOnSuccess={!paper}>
          {paper && <input type="hidden" name="id" value={paper.id} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="p-name" required hint="What people pick on a quote." className="sm:col-span-2">
              <Input id="p-name" name="name" required defaultValue={paper?.name} placeholder="e.g. 100# Gloss Text 12×18" />
            </Field>
            <Field label="Weight / grade" htmlFor="p-weight" hint='e.g. "100# Text", "14pt Cover", "20# Bond".'>
              <Input id="p-weight" name="weight" defaultValue={paper?.weight ?? ""} placeholder="100# Text" />
            </Field>
            <Field label="Sheet size (inches)" htmlFor="p-size" required hint="Width x height as you buy it: 12 x 18, 8.5 x 11, 25 x 38.">
              <Input id="p-size" name="sheetSize" required defaultValue={fmtSheet(paper?.sheetWidthIn, paper?.sheetHeightIn).replace(" × ", " x ")} placeholder="12 x 18" />
            </Field>
            <Field label="Our cost per 1,000 sheets" htmlFor="p-cost" required hint="What you pay for 1,000 sheets (2 reams of 500).">
              <MoneyInput id="p-cost" name="costPerM" required value={cost} onChange={(e) => setCost(e.target.value)} placeholder="80.00" />
            </Field>
            <Field label="Markup on this paper" htmlFor="p-markup" hint="Leave blank to use the category's paper markup (usually 30%).">
              <SuffixInput id="p-markup" name="markupPct" suffix="%" value={markup} onChange={(e) => setMarkup(e.target.value)} placeholder="default" />
            </Field>
            <Field label="Vendor" htmlFor="p-vendor">
              <Select id="p-vendor" name="vendorId" defaultValue={paper?.vendorId ?? ""}>
                <option value="">—</option>
                {vendorOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vendor item # / SKU" htmlFor="p-sku">
              <Input id="p-sku" name="sku" defaultValue={paper?.sku ?? ""} />
            </Field>
          </div>
          <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-[15px] text-slate-700" aria-live="polite">
            {preview ? (
              <>
                One sheet costs us <b className="tabular">{perSheet(preview.costPerSheetCents)}</b> and is charged at about{" "}
                <b className="tabular">{perSheet(preview.pricePerSheetCents)}</b> ({Math.round(preview.markupPct * 1000) / 10}% markup
                {markupPct == null ? ", category default" : ""}).
              </>
            ) : (
              "Enter the cost per 1,000 sheets to see the price per sheet."
            )}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <SaveButton pendingText="Saving…">{paper ? "Save paper" : "Add paper"}</SaveButton>
          </div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
