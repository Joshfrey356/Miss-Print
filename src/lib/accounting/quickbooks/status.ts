/**
 * Reading an accounting_sync row (pure, client-safe).
 *
 *   attempts  > 0                         → "failed"   (error = why; the last try failed)
 *   syncedAt null, or updatedAt > syncedAt → "pending"  (queued; a change hasn't been sent yet)
 *   externalId null                        → "skipped"  (nothing to send; error = why, e.g. void before it was ever sent)
 *   error set                              → "warning"  (sent, with a note — e.g. QuickBooks' tax total differs)
 *   otherwise                              → "synced"
 * Success writes syncedAt = updatedAt = now() and attempts = 0; queueing bumps updatedAt.
 */
export type SyncEntityType = "customer" | "invoice" | "payment";
export type SyncRow = { externalId: string | null; syncToken: string | null; syncedAt: Date | null; error: string | null; attempts: number; updatedAt: Date };
export type SyncState = "none" | "pending" | "failed" | "skipped" | "warning" | "synced";

export function syncState(row: SyncRow | null | undefined): SyncState {
  if (!row) return "none";
  if (row.attempts > 0) return "failed";
  if (!row.syncedAt || row.updatedAt.getTime() > row.syncedAt.getTime()) return "pending";
  if (!row.externalId) return "skipped";
  return row.error ? "warning" : "synced";
}

/** Up to date in QuickBooks (a note is fine). */
export const isSynced = (row: SyncRow | null | undefined) => {
  const s = syncState(row);
  return s === "synced" || s === "warning";
};
