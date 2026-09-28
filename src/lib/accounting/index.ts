import "server-only";
import { qboAppConfig } from "./quickbooks/config";
import { queueAccountingSync, syncQboItems, type SyncItem } from "./quickbooks/server";

/**
 * Accounting integration layer.
 *
 * Miss Print Command Center owns OPERATIONAL data (jobs, quotes, production, job costing).
 * QuickBooks Online (if a shop connects it) remains the AUTHORITATIVE accounting system. The provider
 * sends customers, invoices and payments and stores the remote id in accounting_sync and in each
 * record's `external_id`. Each shop (tenant) connects its own books, so every call names the shop.
 *
 * Changes are pushed automatically: money/service.ts calls queueAccountingSync() after an invoice or
 * payment is created or voided. Settings → Integrations has "Sync now" and "Retry".
 */
export type SyncResult = { ok: boolean; externalId?: string; error?: string; skipped?: string };

export interface AccountingProvider {
  readonly name: string;
  syncCustomer(tenantId: number, customerId: number): Promise<SyncResult>;
  syncInvoice(tenantId: number, invoiceId: number): Promise<SyncResult>;
  syncPayment(tenantId: number, paymentId: number): Promise<SyncResult>;
  syncExpense(tenantId: number, expenseId: number): Promise<SyncResult>;
}

class NoAccounting implements AccountingProvider {
  readonly name = "none";
  async syncCustomer() { return { ok: true }; }
  async syncInvoice() { return { ok: true }; }
  async syncPayment() { return { ok: true }; }
  async syncExpense() { return { ok: true }; }
}

/** QuickBooks Online. A shop that hasn't connected gets { ok: false, error: "QuickBooks isn't connected." }. */
class QuickBooksAccounting implements AccountingProvider {
  readonly name = "quickbooks";
  private async one(tenantId: number, item: SyncItem): Promise<SyncResult> {
    const { results, notConnected } = await syncQboItems(tenantId, [item]);
    const r = results[0];
    if (!r) return { ok: false, error: notConnected ?? "Not synced." };
    if (!r.outcome.ok) return { ok: false, error: r.outcome.error };
    return "skipped" in r.outcome ? { ok: true, skipped: r.outcome.skipped } : { ok: true, externalId: r.outcome.externalId };
  }
  syncCustomer(tenantId: number, id: number) { return this.one(tenantId, { type: "customer", id }); }
  syncInvoice(tenantId: number, id: number) { return this.one(tenantId, { type: "invoice", id }); }
  syncPayment(tenantId: number, id: number) { return this.one(tenantId, { type: "payment", id }); }
  /** Expenses (bills) aren't sent to QuickBooks yet. */
  async syncExpense() { return { ok: true, skipped: "Expenses aren't sent to QuickBooks." }; }
}

/** QuickBooks when this server has Intuit app keys (each shop still has to connect), otherwise none. */
export function accounting(): AccountingProvider {
  return qboAppConfig() ? new QuickBooksAccounting() : new NoAccounting();
}

export { queueAccountingSync };
