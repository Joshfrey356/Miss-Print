"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, requirePermission, requireUser, userCan } from "@/lib/auth";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/activity";
import { plural } from "@/lib/format";
import { disconnectQbo, getQboConnection, retryQboFailures, setQboSyncFrom, syncQboItems, syncQboNow, type SyncNowSummary } from "@/lib/accounting/quickbooks/server";

const PATH = "/settings/integrations";

/** runAction, with a message worked out by the action (shown as the toast). */
async function act<T>(fn: () => Promise<{ message: string; data?: T }>): Promise<ActionResult<T>> {
  const r = await runAction(fn);
  return r.ok ? { ok: true, data: r.data?.data, message: r.data?.message } : r;
}

function describe(s: SyncNowSummary): string {
  if (s.notConnected) throw new UserError(s.notConnected);
  const parts: string[] = [];
  if (s.sent) parts.push(`${plural(s.sent, "record")} sent`);
  if (s.failed) parts.push(`${s.failed} failed`);
  if (s.skipped) parts.push(`${s.skipped} skipped`);
  if (s.notes) parts.push(`${plural(s.notes, "note")} to check`);
  if (s.remaining) parts.push(s.stopped ? `stopped, ${s.remaining} still waiting — try again later` : `${s.remaining} still waiting — click Sync now again`);
  return parts.length ? `${parts.join(" · ")}.` : "Everything is already in QuickBooks.";
}

/** Send everything that isn't in QuickBooks yet (and retry failures). */
export async function syncQuickBooksNow(): Promise<ActionResult<SyncNowSummary>> {
  return act(async () => {
    const user = await requirePermission("settings.manage");
    const s = await syncQboNow(user.tenantId);
    const message = describe(s);
    if (s.sent || s.failed)
      await logActivity({ tenantId: user.tenantId, action: "integration.synced", entityType: "setting", actorId: user.id, summary: `QuickBooks sync: ${message}`, data: { ...s } });
    revalidatePath(PATH);
    return { message, data: s };
  });
}

export async function retryQuickBooksFailures(): Promise<ActionResult<SyncNowSummary>> {
  return act(async () => {
    const user = await requirePermission("settings.manage");
    const s = await retryQboFailures(user.tenantId);
    const message = describe(s);
    revalidatePath(PATH);
    return { message, data: s };
  });
}

const Item = z.object({ type: z.enum(["customer", "invoice", "payment"]), id: z.number().int().positive() });

/** Retry one record (Settings list, or the status badge on an invoice/payment/customer page). */
export async function retryQuickBooksRecord(type: string, id: number): Promise<ActionResult> {
  return act(async () => {
    const user = await requireUser();
    if (!userCan(user, "settings.manage") && !userCan(user, "money.edit")) throw new ForbiddenError();
    const item = Item.parse({ type, id });
    // The engine loads the record scoped to this shop, so another shop's id is simply "not found".
    const { results, notConnected } = await syncQboItems(user.tenantId, [item]);
    const r = results[0];
    if (!r) throw new UserError(notConnected ?? "Couldn't sync that record.");
    revalidatePath(PATH);
    revalidatePath(type === "customer" ? `/customers/${id}` : "/money", type === "customer" ? "page" : "layout");
    if (!r.outcome.ok) throw new UserError(r.outcome.error);
    return { message: "skipped" in r.outcome ? r.outcome.skipped : "Sent to QuickBooks." };
  });
}

export async function disconnectQuickBooks(): Promise<ActionResult> {
  return act(async () => {
    const user = await requirePermission("settings.manage");
    const conn = await getQboConnection(user.tenantId);
    if (!conn || conn.status === "disconnected") throw new UserError("QuickBooks isn't connected.");
    const { revoked } = await disconnectQbo(user.tenantId, user);
    revalidatePath(PATH);
    return {
      message: revoked ? "Disconnected from QuickBooks." : "Disconnected here. QuickBooks couldn't be reached to cancel the sign-in — you can also remove the app in QuickBooks under Apps.",
    };
  });
}

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");

export async function setQuickBooksStartDate(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("settings.manage");
    const syncFrom = Ymd.parse(String(fd.get("syncFrom") ?? ""));
    const conn = await getQboConnection(user.tenantId);
    if (!conn?.active) throw new UserError("Connect QuickBooks first.");
    await setQboSyncFrom(user.tenantId, user, syncFrom);
    revalidatePath(PATH);
  }, "Start date saved");
}
