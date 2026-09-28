"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { runAction, UserError } from "@/lib/actions";
import { createReorderFromRequest, markRequestHandled, reopenRequest } from "@/lib/portal/staff";

const refresh = (id: number) => {
  revalidatePath("/requests");
  revalidatePath(`/requests/${id}`);
  revalidatePath("/dashboard");
};

/** Mark a customer's portal request handled, optionally linking the quote / job that came of it. */
export async function markHandled(id: number, link: { quoteId?: number | null; jobNumber?: number | null } = {}) {
  return runAction(async () => {
    const user = await requirePermission("customers.edit");
    const data = z.object({ quoteId: z.number().int().positive().nullish(), jobNumber: z.number().int().positive().nullish() }).parse(link);
    await markRequestHandled(user.tenantId, Number(id), data, user);
    refresh(id);
  }, "Marked handled");
}

export async function reopen(id: number) {
  return runAction(async () => {
    const user = await requirePermission("customers.edit");
    await reopenRequest(user.tenantId, Number(id), user);
    refresh(id);
  }, "Moved back to new");
}

const ReorderInput = z.object({
  quantity: z.number().int().min(1, "Enter a quantity.").max(10_000_000).nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  notes: z.string().trim().max(4000).nullable(),
  sameArtwork: z.boolean(),
  sameSpecs: z.boolean(),
});

/** "Create the reorder": a new job copied from the original (reorderJob), with the customer's quantity, date and files. */
export async function createReorder(id: number, input: z.input<typeof ReorderInput>) {
  return runAction(async () => {
    const user = await requirePermission("customers.edit");
    if (!can(user.role, "jobs.create")) throw new UserError("You don't have permission to create jobs.");
    const data = ReorderInput.parse(input);
    const job = await createReorderFromRequest(user.tenantId, Number(id), data, user);
    refresh(id);
    revalidatePath("/jobs");
    return job;
  }, "Reorder created");
}
