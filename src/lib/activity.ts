import "server-only";
import { db, type Tx } from "@/lib/db";
import { activityLogs } from "@/lib/db/schema";

export type ActivityInput = {
  /** The shop this happened in. */
  tenantId: number;
  action: string; // "job.status_changed"
  entityType: "job" | "quote" | "customer" | "invoice" | "payment" | "expense" | "user" | "setting" | "file" | "proof" | "task" | "message" | "event" | "knowledge" | "material" | "purchase_order";
  entityId?: number | null;
  jobId?: number | null;
  customerId?: number | null;
  quoteId?: number | null;
  actorId?: number | null;
  summary: string;
  data?: Record<string, unknown> | null;
};

/** Record who did what, when. Call inside the same transaction as the change when possible. */
export async function logActivity(input: ActivityInput, tx: Tx | typeof db = db) {
  await tx.insert(activityLogs).values({
    tenantId: input.tenantId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    jobId: input.jobId ?? null,
    customerId: input.customerId ?? null,
    quoteId: input.quoteId ?? null,
    actorId: input.actorId ?? null,
    summary: input.summary,
    data: input.data ?? null,
  });
}

/** Only the fields that actually changed: { before, after } */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    const nv = after[k];
    const ov = before[k];
    const same = nv instanceof Date && ov instanceof Date ? nv.getTime() === ov.getTime() : nv === ov;
    if (!same && nv !== undefined) {
      b[k] = ov;
      a[k] = nv;
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}
