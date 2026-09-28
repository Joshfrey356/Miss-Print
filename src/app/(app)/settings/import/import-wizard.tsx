"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Contact,
  Download,
  FileSpreadsheet,
  History,
  Layers,
  Loader2,
  Truck,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button, LinkButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Table, THead, Th, Td, Tr } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { IMPORT_KINDS, KINDS, type ImportKind } from "@/lib/import/fields";
import { autoMap, pickFields, toSheet, type Mapping } from "@/lib/import/mapping";
import { normalizeRow, previewColumns, type CategoryRef, type ImportSummary, type Normalized } from "@/lib/import/records";
import { readSpreadsheet, SpreadsheetError } from "@/lib/import/read-file";
import { TEMPLATES, toCsv } from "@/lib/import/templates";
import { beginImport, completeImport, importRows } from "./actions";

const ICONS: Record<ImportKind, LucideIcon> = { customers: Users, contacts: Contact, jobs: History, materials: Layers, vendors: Truck };
const CHUNK_ROWS = 500;
const CHUNK_BYTES = 2_000_000;
const PREVIEW_ROWS = 10;

type Loaded = { filename: string; headers: string[]; rows: string[][]; rowNumbers: number[] };
type Progress = { done: number; total: number; importId: number; nextChunk: number; error?: string };

function download(filename: string, csv: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadTemplate(kind: ImportKind) {
  download(`${kind === "jobs" ? "past-jobs" : kind}-template.csv`, toCsv(TEMPLATES[kind]));
}

/** Are the fields needed to import anything mapped? Returns the missing ones in plain words. */
function missingRequired(kind: ImportKind, m: Mapping): string[] {
  const has = (k: string) => m[k] != null;
  switch (kind) {
    case "customers":
      return has("name") || has("contactFirstName") || has("contactLastName") || has("contactName") ? [] : ["Customer / company name (or First + Last name)"];
    case "contacts":
      return [
        ...(has("customerName") ? [] : ["Customer / company name"]),
        ...(has("name") || has("firstName") || has("lastName") ? [] : ["Contact name (or First + Last name)"]),
      ];
    case "jobs":
      return has("customerName") ? [] : ["Customer name"];
    case "materials":
      return has("name") ? [] : ["Name"];
    default:
      return has("name") ? [] : ["Vendor name"];
  }
}

export function ImportWizard({ categories, help }: { categories: CategoryRef[]; help?: React.ReactNode }) {
  const router = useRouter();
  const [kind, setKind] = React.useState<ImportKind | null>(null);
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [mapping, setMapping] = React.useState<Mapping>({});
  const [reading, setReading] = React.useState(false);
  const [readError, setReadError] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<Progress | null>(null);
  const [summary, setSummary] = React.useState<ImportSummary | null>(null);
  const [problemsOnly, setProblemsOnly] = React.useState(false);
  const running = React.useRef(false);

  const reset = () => {
    setLoaded(null);
    setMapping({});
    setReadError(null);
    setProgress(null);
    setSummary(null);
    setProblemsOnly(false);
  };

  async function onFile(file: File | undefined) {
    if (!file || !kind) return;
    setReading(true);
    setReadError(null);
    try {
      const grid = await readSpreadsheet(file);
      const sheet = toSheet(grid);
      if (!sheet.rows.length) throw new SpreadsheetError("We didn't find any rows under the header row in this file.");
      setLoaded({ filename: file.name, headers: sheet.headers, rows: sheet.rows, rowNumbers: sheet.rowNumbers });
      setMapping(autoMap(sheet.headers, kind));
    } catch (e) {
      setReadError(e instanceof SpreadsheetError ? e.message : "We couldn't read that file. Save it as CSV or .xlsx and try again.");
    } finally {
      setReading(false);
    }
  }

  const normalized = React.useMemo<Normalized[]>(() => {
    if (!loaded || !kind) return [];
    return loaded.rows.map((r) => normalizeRow(kind, pickFields(r, mapping), { categories }));
  }, [loaded, kind, mapping, categories]);

  const counts = React.useMemo(() => {
    const errors = normalized.filter((n) => n.errors.length).length;
    const warnings = normalized.filter((n) => !n.errors.length && n.warnings.length).length;
    return { errors, warnings, ok: normalized.length - errors };
  }, [normalized]);

  async function runImport(from?: Progress) {
    if (!loaded || !kind || running.current) return;
    running.current = true;
    try {
      let importId = from?.importId;
      if (!importId) {
        const r = await beginImport({ kind, filename: loaded.filename });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        importId = r.data!.importId;
      }
      // Chunks of up to 500 rows (smaller when cells are long).
      const chunks: { row: number; values: Record<string, string> }[][] = [];
      let cur: { row: number; values: Record<string, string> }[] = [];
      let bytes = 0;
      loaded.rows.forEach((r, i) => {
        const item = { row: loaded.rowNumbers[i]!, values: pickFields(r, mapping) };
        const size = JSON.stringify(item).length;
        if (cur.length && (cur.length >= CHUNK_ROWS || bytes + size > CHUNK_BYTES)) {
          chunks.push(cur);
          cur = [];
          bytes = 0;
        }
        cur.push(item);
        bytes += size;
      });
      if (cur.length) chunks.push(cur);

      let done = chunks.slice(0, from?.nextChunk ?? 0).reduce((a, c) => a + c.length, 0);
      setProgress({ done, total: loaded.rows.length, importId, nextChunk: from?.nextChunk ?? 0 });
      for (let c = from?.nextChunk ?? 0; c < chunks.length; c++) {
        const r = await importRows({ importId, kind, rows: chunks[c]! });
        if (!r.ok) {
          setProgress({ done, total: loaded.rows.length, importId, nextChunk: c, error: r.error });
          return;
        }
        done += chunks[c]!.length;
        setProgress({ done, total: loaded.rows.length, importId, nextChunk: c + 1 });
      }
      const fin = await completeImport(importId);
      if (!fin.ok) {
        setProgress({ done, total: loaded.rows.length, importId, nextChunk: chunks.length, error: fin.error });
        return;
      }
      setSummary(fin.data!);
      router.refresh();
    } catch {
      setProgress((p) => (p ? { ...p, error: "The connection dropped. Rows saved so far are kept — try again to continue." } : p));
    } finally {
      running.current = false;
    }
  }

  // ---------------------------------------------------------------- results
  if (summary && loaded && kind) {
    return (
      <Results
        kind={kind}
        loaded={loaded}
        summary={summary}
        onAgain={() => {
          reset();
          setKind(null);
        }}
      />
    );
  }

  // ---------------------------------------------------------------- importing
  if (progress && loaded && kind) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <Card>
        <CardHeader title={`Importing ${KINDS[kind].noun} from ${loaded.filename}`} />
        <CardBody className="space-y-4">
          <div className="h-3 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[15px] text-slate-700">
            {progress.done.toLocaleString()} of {progress.total.toLocaleString()} rows saved ({pct}%)
          </p>
          {progress.error ? (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-[15px] text-red-800">
              <p className="font-medium">{progress.error}</p>
              <p className="mt-1 text-sm">The rows saved so far are kept. You can continue where it stopped, or undo this import from the history below.</p>
              <Button variant="primary" className="mt-3" onClick={() => runImport(progress)}>
                Continue importing
              </Button>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" /> Please keep this page open until it finishes.
            </p>
          )}
        </CardBody>
      </Card>
    );
  }

  // ---------------------------------------------------------------- mapping + preview
  if (loaded && kind) {
    const def = KINDS[kind];
    const missing = missingRequired(kind, mapping);
    const used = new Set(Object.values(mapping).filter((v): v is number => v != null));
    const unused = loaded.headers.filter((_, i) => !used.has(i));
    const cols = previewColumns(kind);
    const shown = normalized
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => !problemsOnly || n.errors.length || n.warnings.length)
      .slice(0, problemsOnly ? 100 : PREVIEW_ROWS);
    const example = (col: number | null | undefined) => {
      if (col == null) return "";
      const v = loaded.rows.find((r) => r[col]?.trim())?.[col] ?? "";
      return v.length > 40 ? v.slice(0, 40) + "…" : v;
    };
    return (
      <div className="space-y-5">
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <FileSpreadsheet className="size-5 text-brand-600" /> {loaded.filename}
              </span>
            }
            description={`${loaded.rows.length.toLocaleString()} ${loaded.rows.length === 1 ? "row" : "rows"} of ${def.noun} · ${loaded.headers.length} columns`}
            action={
              <Button size="sm" onClick={reset}>
                <ArrowLeft className="size-4" /> Different file
              </Button>
            }
          />
          <CardBody>
            <h3 className="text-base font-semibold text-slate-900">Match your columns</h3>
            <p className="mt-0.5 text-sm text-slate-500">We matched what we could. Check each one, and pick “Don’t import” for anything you don’t want.</p>
            <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {def.fields.map((f) => (
                <div key={f.key} className="grid gap-1.5 px-3 py-2.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,16rem)_1fr] sm:items-center sm:gap-4">
                  <label htmlFor={`map-${f.key}`} className="text-[15px] font-medium text-slate-800">
                    {f.label}
                    {f.required && <span className="text-red-500"> *</span>}
                    {f.hint && <span className="block text-xs font-normal text-slate-500">{f.hint}</span>}
                  </label>
                  <Select
                    id={`map-${f.key}`}
                    value={mapping[f.key] == null ? "" : String(mapping[f.key])}
                    onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value === "" ? null : Number(e.target.value) }))}
                    className={cn(mapping[f.key] == null && "text-slate-400")}
                  >
                    <option value="">Don’t import</option>
                    {loaded.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h}
                      </option>
                    ))}
                  </Select>
                  <span className="truncate text-sm text-slate-500" title={example(mapping[f.key])}>
                    {mapping[f.key] != null && (example(mapping[f.key]) ? <>e.g. {example(mapping[f.key])}</> : <em>empty column</em>)}
                  </span>
                </div>
              ))}
            </div>
            {unused.length > 0 && (
              <p className="mt-3 text-sm text-slate-500">
                <span className="font-medium text-slate-600">Not imported:</span> {unused.join(", ")}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Preview"
            description={
              problemsOnly ? "Rows with something to check (up to 100)" : `The first ${Math.min(PREVIEW_ROWS, loaded.rows.length)} rows as they'll be saved`
            }
            action={
              counts.errors + counts.warnings > 0 && (
                <Button size="sm" variant={problemsOnly ? "primary" : "secondary"} onClick={() => setProblemsOnly((v) => !v)}>
                  {problemsOnly ? "Show first rows" : "Show rows with problems"}
                </Button>
              )
            }
          />
          <div className="flex flex-wrap gap-2 px-5 pt-3">
            <Badge tone="green">{counts.ok.toLocaleString()} ready</Badge>
            {counts.warnings > 0 && <Badge tone="amber">{counts.warnings.toLocaleString()} with notes</Badge>}
            {counts.errors > 0 && <Badge tone="red">{counts.errors.toLocaleString()} will be skipped</Badge>}
          </div>
          <Table className="mt-2">
            <THead>
              <tr>
                <Th>Row</Th>
                {cols.map((c) => (
                  <Th key={c.label}>{c.label}</Th>
                ))}
              </tr>
            </THead>
            <tbody>
              {shown.map(({ n, i }) => {
                const problems = n.errors.length + n.warnings.length > 0;
                const tint = n.errors.length ? "bg-red-50/60" : n.warnings.length ? "bg-amber-50/50" : "";
                return (
                  <React.Fragment key={i}>
                    <Tr className={cn(tint, problems && "border-b-0")}>
                      <Td className="tabular whitespace-nowrap text-sm text-slate-500">
                        <span className="inline-flex items-center gap-1.5">
                          {n.errors.length ? (
                            <AlertTriangle className="size-4 text-red-600" aria-label="Will be skipped" />
                          ) : n.warnings.length ? (
                            <AlertTriangle className="size-4 text-amber-500" aria-label="Has notes" />
                          ) : (
                            <CheckCircle2 className="size-4 text-emerald-600" aria-label="Looks good" />
                          )}
                          {loaded.rowNumbers[i]}
                        </span>
                      </Td>
                      {n.values ? (
                        cols.map((c) => (
                          <Td key={c.label} className="max-w-64 truncate text-sm" title={c.show(n.values as never)}>
                            {c.show(n.values as never)}
                          </Td>
                        ))
                      ) : (
                        <Td colSpan={cols.length} className="max-w-0 truncate text-sm text-slate-500">
                          {loaded.rows[i]!.filter((v) => v.trim())
                            .slice(0, 5)
                            .join(" · ") || "(empty)"}
                        </Td>
                      )}
                    </Tr>
                    {problems && (
                      <Tr className={tint}>
                        <Td />
                        <Td colSpan={cols.length} className="pt-0 text-sm">
                          {n.errors.map((e) => (
                            <p key={e} className="font-medium text-red-700">
                              Will be skipped: {e}
                            </p>
                          ))}
                          {n.warnings.map((w) => (
                            <p key={w} className="text-amber-800">
                              {w}
                            </p>
                          ))}
                        </Td>
                      </Tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </Table>
          <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              {missing.length ? (
                <span className="font-medium text-red-700">Match a column for: {missing.join(", ")}</span>
              ) : kind === "jobs" ? (
                "Jobs are saved as completed history with your old job numbers. No invoices or payments are created."
              ) : kind === "customers" ? (
                "Customers that already exist (same name or email) only get their blank details filled in."
              ) : (
                "Anything that already exists with the same name only gets its blank details filled in."
              )}
            </p>
            <Button variant="primary" size="lg" disabled={missing.length > 0 || counts.ok === 0} onClick={() => runImport()}>
              <Upload className="size-4" /> Import {counts.ok.toLocaleString()} {counts.ok === 1 ? "row" : "rows"}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // ---------------------------------------------------------------- choose kind + file
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-5">
        <Card>
          <CardHeader title="1. What are you importing?" />
          <CardBody>
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="What to import">
              {IMPORT_KINDS.map((k) => {
                const Icon = ICONS[k];
                const on = kind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      setKind(k);
                      setReadError(null);
                    }}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
                      on ? "border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20" : "border-slate-200 bg-white hover:border-brand-300 hover:bg-slate-50",
                    )}
                  >
                    <span className={cn("rounded-lg p-2", on ? "bg-brand-500 text-white" : "bg-brand-50 text-brand-600")}>
                      <Icon className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold text-slate-900">{KINDS[k].label}</span>
                      <span className="mt-0.5 block text-sm leading-snug text-slate-600">{KINDS[k].description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </CardBody>
        </Card>

        <Card className={cn(!kind && "opacity-60")}>
          <CardHeader
            title="2. Choose your file"
            description="CSV or Excel (.xlsx). The first row should be the column names."
            action={
              kind && (
                <Button size="sm" onClick={() => downloadTemplate(kind)}>
                  <Download className="size-4" /> Template
                </Button>
              )
            }
          />
          <CardBody>
            <label
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center",
                kind ? "cursor-pointer border-slate-300 hover:border-brand-400 hover:bg-brand-50/30" : "cursor-not-allowed border-slate-200",
              )}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onFile(e.dataTransfer.files[0]);
              }}
            >
              {reading ? <Loader2 className="size-8 animate-spin text-brand-500" /> : <Upload className="size-8 text-slate-400" />}
              <span className="text-[15px] font-medium text-slate-800">
                {reading ? "Reading your file…" : kind ? `Choose a file of ${KINDS[kind].noun}` : "Pick what you're importing first"}
              </span>
              <span className="text-sm text-slate-500">or drag it here · .csv or .xlsx</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,.txt,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                disabled={!kind || reading}
                onChange={(e) => {
                  onFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {readError && (
              <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[15px] font-medium text-red-700">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {readError}
              </p>
            )}
          </CardBody>
        </Card>
      </div>
      {help && <aside>{help}</aside>}
    </div>
  );
}

function Results({ kind, loaded, summary, onAgain }: { kind: ImportKind; loaded: Loaded; summary: ImportSummary; onAgain: () => void }) {
  const x = summary.extra ?? {};
  const rowByNumber = React.useMemo(() => new Map(loaded.rowNumbers.map((n, i) => [n, loaded.rows[i]!])), [loaded]);
  const notes = [
    x.customersCreated &&
      `${x.customersCreated} new ${x.customersCreated === 1 ? "customer was" : "customers were"} added for jobs whose customer wasn't on file yet.`,
    x.contactsCreated && kind === "customers" && `${x.contactsCreated} main ${x.contactsCreated === 1 ? "contact" : "contacts"} added.`,
    x.vendorsCreated && `${x.vendorsCreated} new ${x.vendorsCreated === 1 ? "vendor" : "vendors"} added.`,
    x.linesAdded && `${x.linesAdded} ${x.linesAdded === 1 ? "row was" : "rows were"} added as extra lines on a job (same job number).`,
    x.duplicates && `${x.duplicates} ${x.duplicates === 1 ? "job was" : "jobs were"} already imported (same job number) and skipped.`,
    x.unchanged && `${x.unchanged} already on file with nothing new to add.`,
  ].filter(Boolean) as string[];

  const downloadErrors = () => {
    const csv = Papa.unparse({
      fields: ["Row", "Problem", ...loaded.headers],
      data: summary.errors.map((e) => [String(e.row), e.message, ...(rowByNumber.get(e.row) ?? [])]),
    });
    download(`${loaded.filename.replace(/\.[^.]+$/, "")}-problems.csv`, csv);
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-emerald-600" /> Import finished
          </span>
        }
        description={`${KINDS[kind].label} from ${loaded.filename}`}
      />
      <CardBody className="space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Added" value={summary.created} tone="text-emerald-700" />
          <Stat label="Updated" value={summary.updated} tone="text-brand-700" />
          <Stat label="Skipped" value={summary.skipped} tone="text-slate-700" />
          <Stat label="Problems" value={summary.errors.length} tone={summary.errors.length ? "text-red-700" : "text-slate-700"} />
        </div>
        {notes.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-[15px] text-slate-700">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {summary.errors.length > 0 && (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900">Rows that weren’t imported</h3>
              <Button size="sm" onClick={downloadErrors}>
                <Download className="size-4" /> Download these rows (CSV)
              </Button>
            </div>
            <p className="mb-2 text-sm text-slate-500">
              Fix them in the downloaded file (it has your original columns) and import it again — rows already imported are recognized.
            </p>
            <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
              <Table>
                <THead>
                  <tr>
                    <Th>Row</Th>
                    <Th>Problem</Th>
                  </tr>
                </THead>
                <tbody>
                  {summary.errors.slice(0, 200).map((e, i) => (
                    <Tr key={i}>
                      <Td className="tabular text-sm text-slate-500">{e.row}</Td>
                      <Td className="text-sm text-red-700">{e.message}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={onAgain}>
            Import another file
          </Button>
          {kind === "customers" && (
            <LinkButton href="/customers" variant="ghost">
              See customers
            </LinkButton>
          )}
          {kind === "jobs" && (
            <LinkButton href="/quotes/lookup" variant="ghost">
              Try a price lookup
            </LinkButton>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn("tabular mt-1 text-2xl font-semibold", tone)}>{value.toLocaleString()}</p>
    </div>
  );
}
