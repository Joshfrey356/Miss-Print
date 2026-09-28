"use client";
import { useRouter } from "next/navigation";
import { FileClock, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Confirm } from "@/components/ui/confirm";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, Th, Td, Tr } from "@/components/ui/table";
import { useServerAction } from "@/components/use-action";
import { fmtDateTime } from "@/lib/format";
import { KINDS, type ImportKind } from "@/lib/import/fields";
import { undoImportAction } from "./actions";

export type HistoryRow = {
  id: number;
  kind: ImportKind;
  filename: string;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  extraCreated: number;
  by: string | null;
  at: string;
  undoneAt: string | null;
  undoneBy: string | null;
};

const WHAT_UNDO_ARCHIVES: Record<ImportKind, string> = {
  customers: "the customers and contacts this import added",
  contacts: "the contacts this import added",
  jobs: "the past jobs this import added (and any customers it created for them)",
  materials: "the paper and materials this import added (they're turned off) and any vendors it created",
  vendors: "the vendors this import added",
};

export function ImportHistory({ rows }: { rows: HistoryRow[] }) {
  return (
    <Card>
      <CardHeader title="Import history" description="Every import can be undone. Undo archives what it added — nothing is deleted." />
      {rows.length === 0 ? (
        <EmptyState icon={FileClock} title="Nothing has been imported yet." compact />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>What</Th>
              <Th>File</Th>
              <Th className="text-right">Added</Th>
              <Th className="text-right">Updated</Th>
              <Th className="text-right">Skipped</Th>
              <Th className="text-right">Problems</Th>
              <Th>When</Th>
              <Th />
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id} className={r.undoneAt ? "text-slate-400" : ""}>
                <Td className="whitespace-nowrap font-medium">{KINDS[r.kind].label}</Td>
                <Td className="max-w-56 truncate text-sm" title={r.filename}>
                  {r.filename}
                </Td>
                <Td className="tabular text-right">
                  {r.created.toLocaleString()}
                  {r.extraCreated > 0 && <span className="block text-xs text-slate-500">+{r.extraCreated} linked</span>}
                </Td>
                <Td className="tabular text-right">{r.updated.toLocaleString()}</Td>
                <Td className="tabular text-right">{r.skipped.toLocaleString()}</Td>
                <Td className={r.errors && !r.undoneAt ? "tabular text-right text-red-700" : "tabular text-right"}>{r.errors.toLocaleString()}</Td>
                <Td className="whitespace-nowrap text-sm">
                  {fmtDateTime(r.at)}
                  {r.by && <span className="block text-xs text-slate-500">by {r.by}</span>}
                </Td>
                <Td className="text-right">
                  {r.undoneAt ? (
                    <Badge>
                      Undone {fmtDateTime(r.undoneAt)}
                      {r.undoneBy ? ` by ${r.undoneBy}` : ""}
                    </Badge>
                  ) : (
                    <UndoButton row={r} />
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function UndoButton({ row }: { row: HistoryRow }) {
  const router = useRouter();
  const [pending, run] = useServerAction();
  return (
    <Confirm
      title={`Undo the ${KINDS[row.kind].noun} import?`}
      description={
        <>
          This archives {WHAT_UNDO_ARCHIVES[row.kind]} from <strong>{row.filename}</strong>. Nothing is deleted.{" "}
          {row.kind === "customers" || row.kind === "jobs"
            ? "Anything you've added to those customers since (quotes, jobs, notes) stays, and details it filled in on customers you already had are kept."
            : "Details it filled in on records you already had are kept."}
        </>
      }
      confirmLabel="Undo import"
      onConfirm={() => run(() => undoImportAction(row.id), { onSuccess: () => router.refresh() })}
    >
      <Button size="sm" disabled={pending}>
        <Undo2 className="size-4" /> Undo
      </Button>
    </Confirm>
  );
}
