import "server-only";

/**
 * Accounting integration layer.
 *
 * Miss Print Command Center owns OPERATIONAL data (jobs, quotes, production, job costing).
 * QuickBooks (if used) remains the AUTHORITATIVE accounting system. A provider syncs
 * customers, invoices, payments (and optionally expenses) and stores the remote id in
 * each record's `external_id` column. Each shop (tenant) connects its own books, so every
 * call names the shop.
 */
export type SyncResult = { ok: boolean; externalId?: string; error?: string };

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

// Future: class QuickBooksAccounting implements AccountingProvider (OAuth2 via QUICKBOOKS_* env vars).

export function accounting(): AccountingProvider {
  if (process.env.ACCOUNTING_PROVIDER && process.env.ACCOUNTING_PROVIDER !== "none") {
    console.warn(`Accounting provider "${process.env.ACCOUNTING_PROVIDER}" is not implemented yet; using none.`);
  }
  return new NoAccounting();
}
