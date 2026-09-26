"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { runAction, str, UserError, type ActionResult } from "@/lib/actions";
import { can } from "@/lib/permissions";
import { parseMoney, today } from "@/lib/format";
import { saveUpload } from "@/lib/files";
import { createInvoiceFromJob, recordPayment, voidInvoice, voidPayment } from "@/lib/money/service";
import { sendPaymentReminder } from "@/lib/money/reminders";
import { archiveExpense, createExpense, jobFromNumberInput, updateExpense, type ExpenseInput } from "@/lib/money/expenses";
import { EXPENSE_CATEGORIES, EXPENSE_PAYMENT_METHODS, normalizeExpensePayment, PAYMENT_METHODS } from "@/lib/money/labels";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.");

function revalidateMoney() {
  revalidatePath("/money", "layout");
}

/** Used by the Jobs module too: create (or return the existing) invoice for a job. */
export async function createInvoiceForJobAction(jobId: number): Promise<ActionResult<{ id: number; number: number }>> {
  return runAction(async () => {
    const user = await requirePermission("money.edit");
    const id = z.number().int().positive().parse(jobId);
    const inv = await createInvoiceFromJob(user.tenantId, id, { id: user.id, name: user.name });
    revalidateMoney();
    revalidatePath("/jobs", "layout");
    revalidatePath("/customers", "layout");
    return inv;
  }, "Invoice created");
}

const paymentSchema = z.object({
  amountCents: z.number({ error: "Enter a payment amount." }).int().positive("Enter a payment amount."),
  method: z.enum(PAYMENT_METHODS, { error: "Choose how they paid." }),
  reference: z.string().max(100).nullable(),
  receivedOn: ymd,
  notes: z.string().max(2000).nullable(),
});

export async function recordPaymentAction(invoiceId: number, fd: FormData): Promise<ActionResult<{ id: number }>> {
  return runAction(async () => {
    const user = await requirePermission("money.edit");
    const p = paymentSchema.parse({
      amountCents: parseMoney(str(fd, "amount")),
      method: str(fd, "method"),
      reference: str(fd, "reference"),
      receivedOn: str(fd, "receivedOn") ?? today(),
      notes: str(fd, "notes"),
    });
    if (p.receivedOn > today(1)) throw new UserError("The payment date can't be in the future.");
    const pay = await recordPayment(user.tenantId, z.number().int().parse(invoiceId), p, { id: user.id, name: user.name });
    revalidateMoney();
    revalidatePath("/jobs", "layout");
    revalidatePath("/customers", "layout");
    return { id: pay.id };
  }, "Payment recorded");
}

export async function voidInvoiceAction(invoiceId: number, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("money.void");
    await voidInvoice(user.tenantId, z.number().int().parse(invoiceId), z.string().max(500).parse(reason ?? ""), { id: user.id, name: user.name });
    revalidateMoney();
    revalidatePath("/jobs", "layout");
    revalidatePath("/customers", "layout");
  }, "Invoice voided");
}

export async function voidPaymentAction(paymentId: number, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("money.void");
    await voidPayment(user.tenantId, z.number().int().parse(paymentId), z.string().max(500).parse(reason ?? ""), { id: user.id, name: user.name });
    revalidateMoney();
    revalidatePath("/jobs", "layout");
    revalidatePath("/customers", "layout");
  }, "Payment voided");
}

export async function sendReminderAction(invoiceId: number): Promise<ActionResult<{ to: string }>> {
  return runAction(async () => {
    const user = await requirePermission("money.edit");
    const r = await sendPaymentReminder(user.tenantId, z.number().int().parse(invoiceId), { id: user.id, name: user.name });
    revalidateMoney();
    revalidatePath("/customers", "layout");
    return r;
  });
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
const expenseSchema = z.object({
  vendorName: z.string({ error: "Who was it paid to? Enter a vendor." }).min(1, "Who was it paid to? Enter a vendor.").max(200),
  amountCents: z.number({ error: "Enter the amount." }).int().positive("Enter the amount.").max(100_000_000, "That amount looks too large."),
  category: z.enum(EXPENSE_CATEGORIES, { error: "Choose a category." }),
  spentOn: ymd,
  paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS).nullable(),
  notes: z.string().max(2000).nullable(),
});

async function parseExpense(tenantId: number, fd: FormData) {
  const base = expenseSchema.parse({
    vendorName: str(fd, "vendor"),
    amountCents: parseMoney(str(fd, "amount")),
    category: str(fd, "category"),
    spentOn: str(fd, "spentOn") ?? today(),
    paymentMethod: str(fd, "paymentMethod") ? normalizeExpensePayment(str(fd, "paymentMethod")) : null,
    notes: str(fd, "notes"),
  });
  const job = await jobFromNumberInput(tenantId, str(fd, "job"));
  return { input: { ...base, jobId: job?.id ?? null } satisfies ExpenseInput, job };
}

function receiptFrom(fd: FormData) {
  const f = fd.get("receipt");
  return f instanceof File && f.size > 0 ? f : null;
}

type SavedExpense = { id: number; redirectTo: string };

function afterSave(user: { role: Parameters<typeof can>[0] }, job: { number: number } | null, backToJob: boolean) {
  if (backToJob && job) return `/jobs/${job.number}?tab=money`;
  if (can(user.role, "money.view")) return "/money?tab=expenses";
  if (job) return `/jobs/${job.number}?tab=money`;
  return "/money/expenses/new?saved=1";
}

export async function createExpenseAction(fd: FormData): Promise<ActionResult<SavedExpense>> {
  return runAction(async () => {
    const user = await requirePermission("expenses.edit");
    const { input, job } = await parseExpense(user.tenantId, fd);
    const file = receiptFrom(fd);
    let receiptFileId: number | null = null;
    if (file) {
      try {
        receiptFileId = (await saveUpload(file, { folder: "receipt" }, user)).id;
      } catch (e) {
        throw new UserError(e instanceof Error ? e.message : "The receipt couldn't be uploaded.");
      }
    }
    const row = await createExpense(user.tenantId, { ...input, receiptFileId }, { id: user.id, name: user.name });
    revalidateMoney();
    if (job) revalidatePath(`/jobs/${job.number}`);
    return { id: row.id, redirectTo: afterSave(user, job, str(fd, "back") === "job") };
  }, "Expense saved");
}

export async function updateExpenseAction(id: number, fd: FormData): Promise<ActionResult<SavedExpense>> {
  return runAction(async () => {
    const user = await requirePermission("expenses.edit");
    const { input, job } = await parseExpense(user.tenantId, fd);
    const file = receiptFrom(fd);
    let receiptFileId: number | null | undefined = undefined;
    if (file) {
      try {
        receiptFileId = (await saveUpload(file, { folder: "receipt" }, user)).id;
      } catch (e) {
        throw new UserError(e instanceof Error ? e.message : "The receipt couldn't be uploaded.");
      }
    } else if (str(fd, "removeReceipt") === "1") receiptFileId = null;
    await updateExpense(user.tenantId, z.number().int().parse(id), { ...input, receiptFileId }, { id: user.id, name: user.name });
    revalidateMoney();
    revalidatePath("/jobs", "layout");
    return { id, redirectTo: afterSave(user, job, str(fd, "back") === "job") };
  }, "Expense updated");
}

export async function archiveExpenseAction(id: number): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const user = await requirePermission("expenses.edit");
    await archiveExpense(user.tenantId, z.number().int().parse(id), { id: user.id, name: user.name });
    revalidateMoney();
    revalidatePath("/jobs", "layout");
    return { redirectTo: can(user.role, "money.view") ? "/money?tab=expenses" : "/dashboard" };
  }, "Expense removed");
}
