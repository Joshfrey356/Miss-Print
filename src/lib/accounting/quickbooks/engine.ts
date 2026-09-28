/**
 * The QuickBooks sync itself (pure: the database side is a SyncStore, the API side a QboClient,
 * so tests run it against in-memory data and a mocked fetch).
 *
 * Order and dependencies: a payment needs its invoice in QuickBooks, an invoice needs its customer.
 * Each record's result is written through the store (accounting_sync + the record's externalId).
 *
 * Voids:
 * - Invoice → POST /invoice?operation=void (QuickBooks keeps it, zeroed, marked Voided).
 * - Payment → POST /payment?operation=void (supported by the QuickBooks Online API for Payment; it
 *   zeroes the payment and un-applies it from the invoice). If a company rejects the void we fall
 *   back to operation=delete, which removes the payment in QuickBooks. Our own record is never deleted.
 * - A record voided before it was ever sent is not sent at all.
 */
import { QboError, type QboClient, type QboEntity, type QboErrorKind } from "./client";
import {
  customerBody,
  escapeQbo,
  invoiceBody,
  paymentBody,
  pickPaymentMethod,
  QBO_ITEM_NAME,
  qboCustomerQuery,
  qboDisplayName,
  qboDocNumber,
  totalMismatch,
  type LocalCustomer,
  type LocalInvoice,
  type LocalPayment,
} from "./mapping";
import { isSynced, type SyncEntityType, type SyncRow } from "./status";

export interface SyncStore {
  loadCustomer(id: number): Promise<LocalCustomer | null>;
  loadInvoice(id: number): Promise<LocalInvoice | null>;
  loadPayment(id: number): Promise<LocalPayment | null>;
  getRow(type: SyncEntityType, id: number): Promise<SyncRow | null>;
  saveSuccess(type: SyncEntityType, id: number, r: { externalId: string; syncToken: string | null; warning?: string | null }): Promise<void>;
  saveSkipped(type: SyncEntityType, id: number, reason: string): Promise<void>;
  saveFailure(type: SyncEntityType, id: number, error: string): Promise<void>;
}

export type SyncOutcome =
  | { ok: true; externalId: string; warning?: string | null }
  | { ok: true; skipped: string }
  | { ok: false; error: string; reconnect?: boolean; /** Why it failed, when QuickBooks said so (network, rate_limit, validation…). */ kind?: QboErrorKind };

export type EngineOptions = {
  /** US company: send TaxCodeRef TAX/NON per line. Other countries use their own tax codes, so we leave tax to QuickBooks. */
  usTaxCodes: boolean;
  /** Only invoices dated on/after this day (YYYY-MM-DD) are sent, so older ones typed into QuickBooks by hand aren't doubled. */
  syncFrom?: string | null;
};

/** Thrown when a record depends on another that couldn't be sent. Its message is already friendly. */
class DependencyError extends Error {
  constructor(
    message: string,
    readonly kind?: QboErrorKind,
  ) {
    super(message);
  }
}
const kindOf = (e: unknown): QboErrorKind | undefined => (e instanceof QboError || e instanceof DependencyError ? e.kind : undefined);
class Skip extends Error {}

const messageOf = (e: unknown) =>
  e instanceof QboError || e instanceof DependencyError ? e.message : e instanceof Error && e.message ? `Unexpected problem: ${e.message}` : "Unexpected problem while syncing.";

export class QboSyncEngine {
  private itemRef: { value: string; name: string } | null = null;
  private paymentMethods: { Id: string; Name?: string; Active?: boolean }[] | null = null;
  /** Records that already failed in this run, so dependents don't retry them over and over. */
  private failedThisRun = new Map<string, unknown>();

  constructor(
    private readonly client: QboClient,
    private readonly store: SyncStore,
    private readonly opts: EngineOptions,
  ) {}

  syncCustomer(id: number) {
    return this.run("customer", id, () => this.pushCustomer(id));
  }
  syncInvoice(id: number) {
    return this.run("invoice", id, () => this.pushInvoice(id));
  }
  syncPayment(id: number) {
    return this.run("payment", id, () => this.pushPayment(id));
  }

  private async run(type: SyncEntityType, id: number, fn: () => Promise<{ externalId: string; warning?: string | null }>): Promise<SyncOutcome> {
    try {
      return { ok: true, ...(await fn()) };
    } catch (e) {
      if (e instanceof Skip) return { ok: true, skipped: e.message };
      // The push functions record their own failures; this only catches store errors etc.
      const kind = kindOf(e);
      return { ok: false, error: messageOf(e), reconnect: kind === "reconnect", ...(kind ? { kind } : {}) };
    }
  }

  /** Record the result of one push; failures are saved and rethrown for the caller/dependents. */
  private async record<T extends { externalId: string; syncToken: string | null; warning?: string | null }>(
    type: SyncEntityType,
    id: number,
    fn: () => Promise<T | { skipped: string; notFound?: boolean }>,
  ): Promise<{ externalId: string; warning?: string | null }> {
    let r: T | { skipped: string; notFound?: boolean };
    try {
      r = await fn();
    } catch (e) {
      await this.store.saveFailure(type, id, messageOf(e));
      this.failedThisRun.set(`${type}:${id}`, e);
      throw e;
    }
    if ("skipped" in r) {
      // Not found (e.g. another shop's id): nothing is written.
      if (!r.notFound) await this.store.saveSkipped(type, id, r.skipped);
      throw new Skip(r.skipped);
    }
    await this.store.saveSuccess(type, id, { externalId: r.externalId, syncToken: r.syncToken, warning: r.warning ?? null });
    return { externalId: r.externalId, warning: r.warning };
  }

  /** Update with a SyncToken; if it's stale (changed in QuickBooks meanwhile), re-read and try once more. */
  private async update(entity: string, externalId: string, syncToken: string | null, body: Record<string, unknown>): Promise<QboEntity> {
    let token = syncToken;
    if (token == null) token = (await this.client.read(entity, externalId)).SyncToken;
    try {
      return await this.client.save(entity, { ...body, Id: externalId, SyncToken: token, sparse: true });
    } catch (e) {
      if (!(e instanceof QboError && e.kind === "stale")) throw e;
      const fresh = await this.client.read(entity, externalId);
      return this.client.save(entity, { ...body, Id: externalId, SyncToken: fresh.SyncToken, sparse: true });
    }
  }

  private async voidOrDelete(entity: "Invoice" | "Payment", externalId: string, syncToken: string | null): Promise<QboEntity> {
    const ref = async () => ({ Id: externalId, SyncToken: syncToken ?? (await this.client.read(entity, externalId)).SyncToken });
    try {
      return await this.client.operation(entity, "void", await ref());
    } catch (e) {
      if (e instanceof QboError && e.kind === "stale") {
        const fresh = await this.client.read(entity, externalId);
        return this.client.operation(entity, "void", { Id: externalId, SyncToken: fresh.SyncToken });
      }
      // Payments: some companies/versions refuse to void; delete instead (our record is kept either way).
      if (entity === "Payment" && e instanceof QboError && e.kind === "validation") {
        const fresh = await this.client.read(entity, externalId);
        return this.client.operation(entity, "delete", { Id: externalId, SyncToken: fresh.SyncToken });
      }
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // Customers
  // ---------------------------------------------------------------------------
  /** QuickBooks id for our customer; sends it first when needed. */
  private async customerRef(id: number): Promise<string> {
    const row = await this.store.getRow("customer", id);
    if (row?.externalId && isSynced(row)) return row.externalId;
    try {
      if (this.failedThisRun.has(`customer:${id}`)) throw this.failedThisRun.get(`customer:${id}`);
      return (await this.pushCustomer(id)).externalId;
    } catch (e) {
      if (e instanceof Skip) throw new DependencyError(`The customer couldn't be sent: ${e.message}`);
      throw new DependencyError(`The customer couldn't be sent to QuickBooks: ${messageOf(e)}`, kindOf(e));
    }
  }

  private pushCustomer(id: number) {
    return this.record("customer", id, async () => {
      const c = await this.store.loadCustomer(id);
      if (!c) return { skipped: "Customer not found.", notFound: true };
      const row = await this.store.getRow("customer", id);
      const displayName = qboDisplayName(c.name, c.id);
      const body = customerBody(c, displayName);
      if (row?.externalId) {
        // Already linked: send our changes (sparse, so fields only QuickBooks has are kept). Keep the
        // QuickBooks name if it had to be changed to be unique.
        const { DisplayName: _keepQboName, ...changes } = body;
        const saved = await this.update("Customer", row.externalId, row.syncToken, { ...changes, Active: true });
        return { externalId: saved.Id, syncToken: saved.SyncToken };
      }
      // Not linked yet: use a QuickBooks customer with the same name if there is one (active or not),
      // so connecting doesn't duplicate the shop's existing QuickBooks customers.
      const [existing] = await this.client.query("Customer", qboCustomerQuery(displayName));
      if (existing) {
        const saved = existing.Active === false ? await this.update("Customer", existing.Id, existing.SyncToken, { Active: true }) : existing;
        return { externalId: saved.Id, syncToken: saved.SyncToken };
      }
      try {
        const saved = await this.client.save("Customer", body);
        return { externalId: saved.Id, syncToken: saved.SyncToken };
      } catch (e) {
        // The name is taken by a vendor or employee (names are unique across all of them).
        if (!(e instanceof QboError && e.kind === "duplicate_name")) throw e;
        const alt = qboDisplayName(`${displayName} (customer)`);
        const [again] = await this.client.query("Customer", qboCustomerQuery(alt));
        const saved = again ?? (await this.client.save("Customer", { ...body, DisplayName: alt }));
        return { externalId: saved.Id, syncToken: saved.SyncToken };
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Invoices
  // ---------------------------------------------------------------------------
  private async serviceItem(): Promise<{ value: string; name: string }> {
    if (this.itemRef) return this.itemRef;
    const [item] = await this.client.query("Item", `select * from Item where Name = '${escapeQbo(QBO_ITEM_NAME)}'`);
    if (item) return (this.itemRef = { value: item.Id, name: QBO_ITEM_NAME });
    const [income] = await this.client.query("Account", "select * from Account where AccountType = 'Income'");
    if (!income) throw new QboError("QuickBooks has no Income account to put sales in. Add one in QuickBooks (Chart of accounts), then sync again.", "validation");
    const created = await this.client.save("Item", { Name: QBO_ITEM_NAME, Type: "Service", IncomeAccountRef: { value: income.Id } });
    return (this.itemRef = { value: created.Id, name: QBO_ITEM_NAME });
  }

  private async invoiceRef(id: number): Promise<string> {
    const row = await this.store.getRow("invoice", id);
    if (row?.externalId && isSynced(row)) return row.externalId;
    try {
      if (this.failedThisRun.has(`invoice:${id}`)) throw this.failedThisRun.get(`invoice:${id}`);
      return (await this.pushInvoice(id)).externalId;
    } catch (e) {
      if (e instanceof Skip) throw new DependencyError(`Its invoice isn't sent to QuickBooks: ${e.message}`);
      throw new DependencyError(`Its invoice couldn't be sent to QuickBooks: ${messageOf(e)}`, kindOf(e));
    }
  }

  private inScope(date: string) {
    return !this.opts.syncFrom || date >= this.opts.syncFrom;
  }

  private pushInvoice(id: number) {
    return this.record("invoice", id, async () => {
      const inv = await this.store.loadInvoice(id);
      if (!inv) return { skipped: "Invoice not found.", notFound: true };
      const row = await this.store.getRow("invoice", id);
      if (inv.status === "void") {
        if (!row?.externalId) return { skipped: "Voided before it was sent to QuickBooks." };
        const v = await this.voidOrDelete("Invoice", row.externalId, row.syncToken);
        return { externalId: v.Id ?? row.externalId, syncToken: v.SyncToken ?? null };
      }
      if (inv.status === "draft") return { skipped: "Draft — sent once it's finalized." };
      if (!row?.externalId && !this.inScope(inv.issueDate)) return { skipped: `Dated before ${this.opts.syncFrom}, when QuickBooks sync started.` };
      const cust = await this.store.loadCustomer(inv.customerId);
      const customerRef = await this.customerRef(inv.customerId);
      const body = invoiceBody(inv, {
        customerRef,
        itemRef: await this.serviceItem(),
        customerTaxExempt: cust?.taxExempt ?? false,
        usTaxCodes: this.opts.usTaxCodes,
        customerEmail: cust?.email,
      });
      let saved: QboEntity;
      if (row?.externalId) saved = await this.update("Invoice", row.externalId, row.syncToken, body);
      else {
        // Already there (e.g. a previous send worked but saving our side didn't)? Use it — but only if it's for the same customer.
        const docNumber = qboDocNumber(inv.number);
        const [existing] = await this.client.query("Invoice", `select * from Invoice where DocNumber = '${escapeQbo(docNumber)}'`);
        if (existing) {
          const ref = (existing.CustomerRef as { value?: string } | undefined)?.value;
          if (ref !== customerRef)
            throw new QboError(`QuickBooks already has an invoice numbered ${docNumber} for a different customer. Rename or void it in QuickBooks, then retry.`, "validation");
          saved = await this.update("Invoice", existing.Id, existing.SyncToken, body);
        } else saved = await this.client.save("Invoice", body);
      }
      return { externalId: saved.Id, syncToken: saved.SyncToken, warning: totalMismatch(inv.totalCents, saved.TotalAmt) };
    });
  }

  // ---------------------------------------------------------------------------
  // Payments
  // ---------------------------------------------------------------------------
  private async methodRef(method: LocalPayment["method"]) {
    if (method === "other") return null;
    if (!this.paymentMethods) this.paymentMethods = await this.client.query("PaymentMethod", "select * from PaymentMethod");
    return pickPaymentMethod(method, this.paymentMethods);
  }

  private pushPayment(id: number) {
    return this.record("payment", id, async () => {
      const p = await this.store.loadPayment(id);
      if (!p) return { skipped: "Payment not found.", notFound: true };
      const row = await this.store.getRow("payment", id);
      if (p.voidedAt) {
        if (!row?.externalId) return { skipped: "Voided before it was sent to QuickBooks." };
        const v = await this.voidOrDelete("Payment", row.externalId, row.syncToken);
        return { externalId: v.Id ?? row.externalId, syncToken: v.SyncToken ?? null };
      }
      const inv = await this.store.loadInvoice(p.invoiceId);
      if (!inv) return { skipped: "Its invoice wasn't found." };
      const invRow = await this.store.getRow("invoice", p.invoiceId);
      if (!invRow?.externalId && !this.inScope(inv.issueDate))
        return { skipped: `Its invoice is dated before ${this.opts.syncFrom}, when QuickBooks sync started — record this payment in QuickBooks by hand.` };
      const invoiceRef = await this.invoiceRef(p.invoiceId);
      const customerRef = await this.customerRef(p.customerId);
      const body = paymentBody(p, { customerRef, invoiceRef, paymentMethodRef: await this.methodRef(p.method) });
      const saved = row?.externalId ? await this.update("Payment", row.externalId, row.syncToken, body) : await this.client.save("Payment", body);
      return { externalId: saved.Id, syncToken: saved.SyncToken };
    });
  }
}
