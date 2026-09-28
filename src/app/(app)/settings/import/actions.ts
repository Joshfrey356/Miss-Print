"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { runAction, type ActionResult } from "@/lib/actions";
import { IMPORT_KINDS } from "@/lib/import/fields";
import { finishImport, importChunk, startImport, undoImport, type ImportSummary } from "@/lib/import/server";

const kindSchema = z.enum(IMPORT_KINDS, { error: "Please choose what you're importing." });
const idSchema = z.number({ error: "That import wasn't found." }).int().positive();

/** Step 1: create the import record (its id goes on every row created). */
export async function beginImport(input: { kind: string; filename: string }): Promise<ActionResult<{ importId: number }>> {
  return runAction(async () => {
    const user = await requirePermission("settings.manage");
    const kind = kindSchema.parse(input.kind);
    const filename = z.string().max(300).parse(input.filename ?? "").trim();
    return { importId: await startImport(user.tenantId, user.id, kind, filename) };
  });
}

const chunkSchema = z.object({
  importId: idSchema,
  kind: kindSchema,
  rows: z
    .array(
      z.object({
        row: z.number().int().positive(),
        values: z.record(z.string().max(40), z.string().max(20_000)),
      }),
    )
    .min(1)
    .max(1000, "Send at most 1,000 rows at a time."),
});

/** Step 2 (repeated): save up to 1,000 rows. Returns the running totals. */
export async function importRows(input: z.input<typeof chunkSchema>): Promise<ActionResult<ImportSummary>> {
  return runAction(async () => {
    const user = await requirePermission("settings.manage");
    const { importId, kind, rows } = chunkSchema.parse(input);
    return importChunk(user.tenantId, user.id, importId, kind, rows);
  });
}

/** Step 3: log it once and refresh the pages that show imported data. */
export async function completeImport(importId: number): Promise<ActionResult<ImportSummary>> {
  return runAction(async () => {
    const user = await requirePermission("settings.manage");
    const summary = await finishImport(user.tenantId, user.id, idSchema.parse(importId));
    revalidateImported();
    return summary;
  });
}

export async function undoImportAction(importId: number): Promise<ActionResult<Awaited<ReturnType<typeof undoImport>>>> {
  return runAction(async () => {
    const user = await requirePermission("settings.manage");
    const counts = await undoImport(user.tenantId, user.id, idSchema.parse(importId));
    revalidateImported();
    return counts;
  }, "Import undone");
}

function revalidateImported() {
  revalidatePath("/settings/import");
  revalidatePath("/customers");
  revalidatePath("/jobs");
  revalidatePath("/quotes/lookup");
  revalidatePath("/settings/paper");
}
