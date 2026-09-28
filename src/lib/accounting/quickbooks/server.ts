import "server-only";
import { createHash } from "node:crypto";
import { after } from "next/server";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { accountingSync, customers, invoiceItems, invoices, payments, tenantIntegrations, users } from "@/lib/db/schema";
import { openSecret, sealSecret, secretsConfigured } from "@/lib/secrets";
import { logActivity } from "@/lib/activity";
import { invoiceNo, money, today } from "@/lib/format";
import { qboAppConfig, qboEnvironment, type QboEnvironment } from "./config";
import { QboClient, QboError, type TokenStore } from "./client";
import { QboSyncEngine, type SyncOutcome, type SyncStore } from "./engine";
import { accessTokenExpired, revokeToken, type FetchLike, type QboTokens } from "./oauth";
import { syncState, type SyncEntityType, type SyncRow, type SyncState } from "./status";

/**
 * QuickBooks Online, per shop: the database side of the sync (connection row, tokens, accounting_sync).
 *
 * tenant_integrations (provider "quickbooks"):
 *   config  = { realmId, companyName, environment, country, syncFrom }   (shown in Settings)
 *   secret  = sealSecret({ accessToken, refreshToken, expiresAt, refreshExpiresAt })
 *   status  = connected | error (needs reconnect) | disconnected (row kept, secret cleared)
 */
export type QboConfig = { realmId: string; companyName: string | null; environment: QboEnvironment; country: string | null; syncFrom: string | null };
export type SyncItem = { type: SyncEntityType; id: number };

const PROVIDER = "quickbooks" as const;
const byProvider = (tenantId: number) => and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.provider, PROVIDER));

/** Key for signing the OAuth `state` (derived from APP_SECRET_KEY, separate from the encryption key). */
export function oauthStateKey(): Buffer {
  const raw = process.env.APP_SECRET_KEY?.trim() || "dev-only-app-secret-key";
  return createHash("sha256").update(`quickbooks-oauth-state\0${raw}`).digest();
}

function readConfig(c: Record<string, unknown> | null | undefined): QboConfig {
  const s = (k: string) => (typeof c?.[k] === "string" && (c[k] as string).trim() ? (c[k] as string) : null);
  return { realmId: s("realmId") ?? "", companyName: s("companyName"), environment: s("environment") === "sandbox" ? "sandbox" : "production", country: s("country"), syncFrom: s("syncFrom") };
}

export async function getQboConnection(tenantId: number) {
  const [row] = await db.select().from(tenantIntegrations).where(byProvider(tenantId));
  if (!row) return null;
  return { ...row, config: readConfig(row.config), active: row.status !== "disconnected" && !!row.secret && !!readConfig(row.config).realmId };
}
type Conn = NonNullable<Awaited<ReturnType<typeof getQboConnection>>>;

// ---------------------------------------------------------------------------
// Connect / disconnect
// ---------------------------------------------------------------------------
export async function saveQboConnection(
  tenantId: number,
  actor: { id: number; name: string },
  c: { realmId: string; companyName: string | null; country: string | null; environment: QboEnvironment; tokens: QboTokens },
) {
  const prev = await getQboConnection(tenantId);
  const companyChanged = !!prev?.config.realmId && prev.config.realmId !== c.realmId;
  const config: QboConfig = {
    realmId: c.realmId,
    companyName: c.companyName,
    environment: c.environment,
    country: c.country,
    // Keep the start date on a reconnect to the same company; a new company starts from today.
    syncFrom: !companyChanged && prev?.config.syncFrom ? prev.config.syncFrom : today(),
  };
  await db.transaction(async (tx) => {
    if (companyChanged) {
      // A different QuickBooks company: the ids we stored belong to the old one. accounting_sync is
      // sync bookkeeping (not a business record), so it's cleared; the invoices/payments themselves stay.
      await tx.delete(accountingSync).where(eq(accountingSync.tenantId, tenantId));
      await tx.update(customers).set({ externalId: null }).where(and(eq(customers.tenantId, tenantId), isNotNull(customers.externalId)));
      await tx.update(invoices).set({ externalId: null }).where(and(eq(invoices.tenantId, tenantId), isNotNull(invoices.externalId)));
      await tx.update(payments).set({ externalId: null }).where(and(eq(payments.tenantId, tenantId), isNotNull(payments.externalId)));
    }
    const values = { config, secret: sealSecret(c.tokens), status: "connected" as const, lastError: null, connectedBy: actor.id, connectedAt: new Date(), updatedAt: new Date() };
    await tx
      .insert(tenantIntegrations)
      .values({ tenantId, provider: PROVIDER, ...values })
      .onConflictDoUpdate({ target: [tenantIntegrations.tenantId, tenantIntegrations.provider], set: values });
    await logActivity(
      {
        tenantId,
        action: "integration.connected",
        entityType: "setting",
        actorId: actor.id,
        summary: `Connected QuickBooks Online${c.companyName ? ` (${c.companyName})` : ""}${companyChanged ? " — a different company than before, so sync starts fresh" : ""}`,
        data: { provider: PROVIDER, realmId: c.realmId, environment: c.environment },
      },
      tx,
    );
  });
}

/** Revoke our access at Intuit (best effort) and mark disconnected. The row and sync history are kept. */
export async function disconnectQbo(tenantId: number, actor: { id: number; name: string }, fetchFn: FetchLike = (u, i) => fetch(u, i)) {
  const conn = await getQboConnection(tenantId);
  if (!conn || conn.status === "disconnected") return { revoked: true };
  let revoked = true;
  const app = qboAppConfig();
  if (conn.secret && app) {
    try {
      const t = openSecret<QboTokens>(conn.secret);
      revoked = await revokeToken(fetchFn, app, t.refreshToken);
    } catch {
      revoked = false;
    }
  }
  await db
    .update(tenantIntegrations)
    .set({ status: "disconnected", secret: null, lastError: null, updatedAt: new Date() })
    .where(byProvider(tenantId));
  await logActivity({
    tenantId,
    action: "integration.disconnected",
    entityType: "setting",
    actorId: actor.id,
    summary: `Disconnected QuickBooks Online${conn.config.companyName ? ` (${conn.config.companyName})` : ""}`,
    data: { provider: PROVIDER, revoked },
  });
  return { revoked };
}

export async function setQboSyncFrom(tenantId: number, actor: { id: number }, syncFrom: string) {
  const conn = await getQboConnection(tenantId);
  if (!conn) return;
  const before = conn.config.syncFrom;
  await db
    .update(tenantIntegrations)
    .set({ config: { ...conn.config, syncFrom }, updatedAt: new Date() })
    .where(byProvider(tenantId));
  await logActivity({
    tenantId,
    action: "integration.updated",
    entityType: "setting",
    actorId: actor.id,
    summary: `QuickBooks sync now sends invoices dated ${syncFrom} or later`,
    data: { before: { syncFrom: before }, after: { syncFrom } },
  });
}

// ---------------------------------------------------------------------------
// Database side of the engine
// ---------------------------------------------------------------------------
const ENTITY_TABLE = { customer: customers, invoice: invoices, payment: payments } as const;

class DbSyncStore implements SyncStore {
  constructor(private readonly tenantId: number) {}

  async loadCustomer(id: number) {
    const [c] = await db
      .select({ id: customers.id, name: customers.name, isCompany: customers.isCompany, email: customers.email, phone: customers.phone, website: customers.website, address: customers.address, city: customers.city, state: customers.state, zip: customers.zip, billingAddress: customers.billingAddress, taxExempt: customers.taxExempt })
      .from(customers)
      .where(and(eq(customers.tenantId, this.tenantId), eq(customers.id, id)));
    return c ?? null;
  }

  async loadInvoice(id: number) {
    const [inv] = await db.select().from(invoices).where(and(eq(invoices.tenantId, this.tenantId), eq(invoices.id, id)));
    if (!inv) return null;
    const items = await db
      .select({ description: invoiceItems.description, quantity: invoiceItems.quantity, amountCents: invoiceItems.amountCents, taxable: invoiceItems.taxable })
      .from(invoiceItems)
      .where(and(eq(invoiceItems.tenantId, this.tenantId), eq(invoiceItems.invoiceId, id)))
      .orderBy(asc(invoiceItems.sortOrder), asc(invoiceItems.id));
    return { id: inv.id, number: inv.number, customerId: inv.customerId, status: inv.status, issueDate: inv.issueDate, dueDate: inv.dueDate, poNumber: inv.poNumber, notes: inv.notes, taxCents: inv.taxCents, totalCents: inv.totalCents, items };
  }

  async loadPayment(id: number) {
    const [p] = await db
      .select({ id: payments.id, invoiceId: payments.invoiceId, customerId: payments.customerId, amountCents: payments.amountCents, method: payments.method, reference: payments.reference, receivedOn: payments.receivedOn, notes: payments.notes, voidedAt: payments.voidedAt })
      .from(payments)
      .where(and(eq(payments.tenantId, this.tenantId), eq(payments.id, id)));
    return p ?? null;
  }

  async getRow(type: SyncEntityType, id: number): Promise<SyncRow | null> {
    const [r] = await db
      .select({ externalId: accountingSync.externalId, syncToken: accountingSync.syncToken, syncedAt: accountingSync.syncedAt, error: accountingSync.error, attempts: accountingSync.attempts, updatedAt: accountingSync.updatedAt })
      .from(accountingSync)
      .where(and(eq(accountingSync.tenantId, this.tenantId), eq(accountingSync.entityType, type), eq(accountingSync.entityId, id)));
    return r ?? null;
  }

  private upsert(type: SyncEntityType, id: number, set: { [K in keyof typeof accountingSync.$inferInsert]?: (typeof accountingSync.$inferInsert)[K] | SQL }) {
    return db
      .insert(accountingSync)
      .values({ tenantId: this.tenantId, entityType: type, entityId: id, ...set })
      .onConflictDoUpdate({ target: [accountingSync.tenantId, accountingSync.entityType, accountingSync.entityId], set });
  }

  async saveSuccess(type: SyncEntityType, id: number, r: { externalId: string; syncToken: string | null; warning?: string | null }) {
    // syncedAt and updatedAt get the same now() so the row reads as up to date (see status.ts).
    await this.upsert(type, id, { externalId: r.externalId, syncToken: r.syncToken, syncedAt: sql`now()`, updatedAt: sql`now()`, error: r.warning ?? null, attempts: 0 });
    const t = ENTITY_TABLE[type];
    await db.update(t).set({ externalId: r.externalId }).where(and(eq(t.tenantId, this.tenantId), eq(t.id, id)));
  }

  async saveSkipped(type: SyncEntityType, id: number, reason: string) {
    await this.upsert(type, id, { syncedAt: sql`now()`, updatedAt: sql`now()`, error: reason, attempts: 0 });
  }

  async saveFailure(type: SyncEntityType, id: number, error: string) {
    await db
      .insert(accountingSync)
      .values({ tenantId: this.tenantId, entityType: type, entityId: id, error, attempts: 1 })
      .onConflictDoUpdate({
        target: [accountingSync.tenantId, accountingSync.entityType, accountingSync.entityId],
        set: { error, attempts: sql`${accountingSync.attempts} + 1`, updatedAt: sql`now()` },
      });
  }
}

/** Tokens from the connection row; refreshes under a row lock so two syncs never spend the same refresh token. */
class DbTokenStore implements TokenStore {
  constructor(
    private readonly tenantId: number,
    private current: QboTokens,
  ) {}
  async get() {
    return this.current;
  }
  async refresh(stale: QboTokens, doRefresh: (cur: QboTokens) => Promise<QboTokens>) {
    const next = await db.transaction(async (tx) => {
      const [row] = await tx.select({ secret: tenantIntegrations.secret, status: tenantIntegrations.status }).from(tenantIntegrations).where(byProvider(this.tenantId)).for("update");
      if (!row?.secret || row.status === "disconnected") throw new QboError("QuickBooks is disconnected. Connect it again in Settings → Integrations.", "reconnect");
      const cur = openSecret<QboTokens>(row.secret);
      // Someone else refreshed while we waited: use theirs.
      if (cur.accessToken !== stale.accessToken && !accessTokenExpired(cur)) return cur;
      const fresh = await doRefresh(cur);
      await tx.update(tenantIntegrations).set({ secret: sealSecret(fresh), updatedAt: new Date() }).where(byProvider(this.tenantId));
      return fresh;
    });
    this.current = next;
    return next;
  }
}

/** For tests on a dev server: route API calls elsewhere. Production always uses real fetch. */
let fetchOverride: FetchLike | null = null;
export function setQboFetchForTesting(f: FetchLike | null) {
  if (process.env.NODE_ENV !== "production") fetchOverride = f;
}

export function qboClientFor(tenantId: number, conn: Conn, tokens: TokenStore = new DbTokenStore(tenantId, openSecret<QboTokens>(conn.secret!))) {
  const app = qboAppConfig();
  if (!app) throw new QboError("QuickBooks isn't set up on this server.", "auth");
  return new QboClient({ app, realmId: conn.config.realmId, environment: conn.config.environment, tokens, fetch: fetchOverride ?? undefined });
}

// ---------------------------------------------------------------------------
// Running syncs
// ---------------------------------------------------------------------------
const g = globalThis as unknown as { __qboLocks?: Map<number, Promise<unknown>> };
/** One sync at a time per shop in this server process (so a counter sale's invoice and payment don't race). */
function withTenantLock<T>(tenantId: number, fn: () => Promise<T>): Promise<T> {
  const locks = (g.__qboLocks ??= new Map());
  const prev = locks.get(tenantId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  locks.set(tenantId, tail);
  void tail.then(() => {
    if (locks.get(tenantId) === tail) locks.delete(tenantId);
  });
  return run;
}

export type SyncRunResult = { item: SyncItem; outcome: SyncOutcome };

async function runItems(tenantId: number, items: SyncItem[], opts: { deadline?: number } = {}): Promise<{ results: SyncRunResult[]; notConnected?: string; stopped?: boolean }> {
  const conn = await getQboConnection(tenantId);
  if (!conn?.active) return { results: [], notConnected: "QuickBooks isn't connected." };
  if (!qboAppConfig()) return { results: [], notConnected: "QuickBooks isn't set up on this server." };
  let client: QboClient;
  try {
    client = qboClientFor(tenantId, conn);
  } catch {
    await db.update(tenantIntegrations).set({ status: "error", lastError: "The saved QuickBooks sign-in can't be read (the server's APP_SECRET_KEY changed?). Connect again.", updatedAt: new Date() }).where(byProvider(tenantId));
    return { results: [], notConnected: "The saved QuickBooks sign-in can't be read. Connect again." };
  }
  const engine = new QboSyncEngine(client, new DbSyncStore(tenantId), { usTaxCodes: !conn.config.country || conn.config.country === "US", syncFrom: conn.config.syncFrom });
  const results: SyncRunResult[] = [];
  let stopped = false;
  for (const item of items) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    const outcome = item.type === "customer" ? await engine.syncCustomer(item.id) : item.type === "invoice" ? await engine.syncInvoice(item.id) : await engine.syncPayment(item.id);
    results.push({ item, outcome });
    // Signed out at Intuit, QuickBooks unreachable or rate-limiting: stop — the rest would fail the same
    // way. They stay "waiting" and go on the next sync.
    if (!outcome.ok && (outcome.reconnect || outcome.kind === "network" || outcome.kind === "rate_limit" || outcome.kind === "server")) {
      stopped = true;
      break;
    }
  }
  const failed = results.filter((r): r is SyncRunResult & { outcome: { ok: false; error: string; reconnect?: boolean } } => !r.outcome.ok);
  const reconnect = failed.find((f) => f.outcome.reconnect);
  if (reconnect) {
    await db.update(tenantIntegrations).set({ status: "error", lastError: reconnect.outcome.error, updatedAt: new Date() }).where(byProvider(tenantId));
  } else if (failed.length) {
    const last = failed[failed.length - 1]!;
    await db.update(tenantIntegrations).set({ lastError: `${await labelFor(tenantId, last.item)}: ${last.outcome.error}`, updatedAt: new Date() }).where(byProvider(tenantId));
  } else if (results.length && (conn.lastError || conn.status === "error")) {
    await db.update(tenantIntegrations).set({ status: "connected", lastError: null, updatedAt: new Date() }).where(byProvider(tenantId));
  }
  return { results, stopped };
}

/** Sync these records now (waits for the result). */
export function syncQboItems(tenantId: number, items: SyncItem[]) {
  return withTenantLock(tenantId, () => runItems(tenantId, items));
}

/**
 * Called by money/service.ts after a change commits. Marks the records as waiting (so "Sync now" picks
 * them up even if this server stops) and sends them in the background with after(); outside a request
 * it just starts the work without waiting. Never throws and never slows the user down beyond two small
 * queries (one when QuickBooks isn't connected, none when it isn't set up on this server).
 */
export async function queueAccountingSync(tenantId: number, items: SyncItem[]): Promise<void> {
  try {
    if (!items.length || !qboAppConfig()) return;
    const [conn] = await db.select({ status: tenantIntegrations.status, hasSecret: sql<boolean>`${tenantIntegrations.secret} is not null` }).from(tenantIntegrations).where(byProvider(tenantId));
    if (!conn || conn.status === "disconnected" || !conn.hasSecret) return;
    for (const it of items)
      await db
        .insert(accountingSync)
        .values({ tenantId, entityType: it.type, entityId: it.id })
        .onConflictDoUpdate({ target: [accountingSync.tenantId, accountingSync.entityType, accountingSync.entityId], set: { updatedAt: sql`now()` } });
    const task = () =>
      syncQboItems(tenantId, items).then(
        () => undefined,
        (e) => console.error("[quickbooks] background sync failed", e),
      );
    try {
      after(task);
    } catch {
      void task(); // not inside a request (script, test): fire and forget
    }
  } catch (e) {
    console.error("[quickbooks] couldn't queue sync", e);
  }
}

// ---------------------------------------------------------------------------
// What still needs sending
// ---------------------------------------------------------------------------
/** Row exists and needs work: failed, or queued after the last send. */
const rowNeedsWork = (includeFailed: boolean): SQL =>
  and(
    isNotNull(accountingSync.id),
    or(
      ...(includeFailed ? [gt(accountingSync.attempts, 0)] : []),
      and(eq(accountingSync.attempts, 0), or(isNull(accountingSync.syncedAt), gt(accountingSync.updatedAt, accountingSync.syncedAt))),
    ),
  )!;

const syncJoin = (type: SyncEntityType, idCol: AnyPgColumn, tenantCol: AnyPgColumn) =>
  and(eq(accountingSync.tenantId, tenantCol), eq(accountingSync.entityType, type), eq(accountingSync.entityId, idCol));

async function pendingItems(tenantId: number, syncFrom: string | null, includeFailed: boolean): Promise<SyncItem[]> {
  const custRows = await db
    .select({ id: accountingSync.entityId })
    .from(accountingSync)
    .where(and(eq(accountingSync.tenantId, tenantId), eq(accountingSync.entityType, "customer"), rowNeedsWork(includeFailed)))
    .orderBy(asc(accountingSync.entityId));
  const invRows = await db
    .select({ id: invoices.id })
    .from(invoices)
    .leftJoin(accountingSync, syncJoin("invoice", invoices.id, invoices.tenantId))
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        ne(invoices.status, "draft"),
        or(and(isNull(accountingSync.id), ne(invoices.status, "void"), syncFrom ? gte(invoices.issueDate, syncFrom) : undefined), rowNeedsWork(includeFailed)),
      ),
    )
    .orderBy(asc(invoices.issueDate), asc(invoices.id));
  const payRows = await db
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(invoices, and(eq(invoices.tenantId, payments.tenantId), eq(invoices.id, payments.invoiceId)))
    .leftJoin(accountingSync, syncJoin("payment", payments.id, payments.tenantId))
    .where(
      and(
        eq(payments.tenantId, tenantId),
        or(and(isNull(accountingSync.id), isNull(payments.voidedAt), syncFrom ? gte(invoices.issueDate, syncFrom) : undefined), rowNeedsWork(includeFailed)),
      ),
    )
    .orderBy(asc(payments.receivedOn), asc(payments.id));
  return [
    ...custRows.map((r) => ({ type: "customer" as const, id: r.id })),
    ...invRows.map((r) => ({ type: "invoice" as const, id: r.id })),
    ...payRows.map((r) => ({ type: "payment" as const, id: r.id })),
  ];
}

export type SyncNowSummary = {
  sent: number;
  skipped: number;
  failed: number;
  notes: number;
  remaining: number;
  firstError: string | null;
  notConnected?: string;
  /** Stopped early because QuickBooks couldn't be reached, was rate-limiting, or signed us out. */
  stopped?: boolean;
};

function summarize(results: SyncRunResult[], total: number): SyncNowSummary {
  const s: SyncNowSummary = { sent: 0, skipped: 0, failed: 0, notes: 0, remaining: Math.max(0, total - results.length), firstError: null };
  for (const r of results) {
    if (!r.outcome.ok) {
      s.failed++;
      s.firstError ??= r.outcome.error;
    } else if ("skipped" in r.outcome) s.skipped++;
    else {
      s.sent++;
      if (r.outcome.warning) s.notes++;
    }
  }
  return s;
}

/** "Sync now": everything not yet sent, plus failures, in order (customers, invoices, payments). Time-boxed. */
export function syncQboNow(tenantId: number, opts: { limit?: number; budgetMs?: number } = {}): Promise<SyncNowSummary> {
  return withTenantLock(tenantId, async () => {
    const conn = await getQboConnection(tenantId);
    if (!conn?.active) return { ...summarize([], 0), notConnected: "QuickBooks isn't connected." };
    const all = await pendingItems(tenantId, conn.config.syncFrom, true);
    const batch = all.slice(0, opts.limit ?? 200);
    const { results, notConnected, stopped } = await runItems(tenantId, batch, { deadline: Date.now() + (opts.budgetMs ?? 45_000) });
    return { ...summarize(results, all.length), notConnected, stopped };
  });
}

/** Retry only what failed. */
export function retryQboFailures(tenantId: number): Promise<SyncNowSummary> {
  return withTenantLock(tenantId, async () => {
    const rows = await db
      .select({ type: accountingSync.entityType, id: accountingSync.entityId })
      .from(accountingSync)
      .where(and(eq(accountingSync.tenantId, tenantId), gt(accountingSync.attempts, 0)));
    const order = { customer: 0, invoice: 1, payment: 2 } as const;
    const items = rows.sort((a, b) => order[a.type] - order[b.type] || a.id - b.id);
    const { results, notConnected, stopped } = await runItems(tenantId, items, { deadline: Date.now() + 45_000 });
    return { ...summarize(results, items.length), notConnected, stopped };
  });
}

// ---------------------------------------------------------------------------
// For Settings and the status badge
// ---------------------------------------------------------------------------
export type SyncListItem = { type: SyncEntityType; id: number; label: string; href: string; error: string; attempts: number; updatedAt: Date };

async function labels(tenantId: number, items: { type: SyncEntityType; id: number }[]) {
  const ids = (t: SyncEntityType) => items.filter((i) => i.type === t).map((i) => i.id);
  const out = new Map<string, { label: string; href: string }>();
  const c = ids("customer");
  if (c.length)
    for (const r of await db.select({ id: customers.id, name: customers.name }).from(customers).where(and(eq(customers.tenantId, tenantId), inArray(customers.id, c))))
      out.set(`customer:${r.id}`, { label: `Customer ${r.name}`, href: `/customers/${r.id}` });
  const i = ids("invoice");
  if (i.length)
    for (const r of await db.select({ id: invoices.id, number: invoices.number }).from(invoices).where(and(eq(invoices.tenantId, tenantId), inArray(invoices.id, i))))
      out.set(`invoice:${r.id}`, { label: `Invoice ${invoiceNo(r.number)}`, href: `/money/invoices/${r.id}` });
  const p = ids("payment");
  if (p.length)
    for (const r of await db
      .select({ id: payments.id, amount: payments.amountCents, invoiceId: payments.invoiceId, number: invoices.number })
      .from(payments)
      .innerJoin(invoices, and(eq(invoices.tenantId, payments.tenantId), eq(invoices.id, payments.invoiceId)))
      .where(and(eq(payments.tenantId, tenantId), inArray(payments.id, p))))
      out.set(`payment:${r.id}`, { label: `Payment ${money(r.amount)} on ${invoiceNo(r.number)}`, href: `/money/invoices/${r.invoiceId}` });
  return out;
}

async function labelFor(tenantId: number, item: SyncItem) {
  return (await labels(tenantId, [item])).get(`${item.type}:${item.id}`)?.label ?? `${item.type} ${item.id}`;
}

export async function getQboOverview(tenantId: number) {
  const conn = await getQboConnection(tenantId);
  const app = qboAppConfig();
  const base = { appConfigured: !!app, serverEnvironment: qboEnvironment(), secretsOk: secretsConfigured(), connection: conn };
  if (!conn?.active) return { ...base, counts: null, lastSyncAt: null, failures: [], notes: [], connectedByName: null };

  const [agg] = await db
    .select({
      synced: sql<number>`count(*) filter (where ${accountingSync.attempts} = 0 and ${accountingSync.externalId} is not null and ${accountingSync.syncedAt} >= ${accountingSync.updatedAt})::int`,
      failed: sql<number>`count(*) filter (where ${accountingSync.attempts} > 0)::int`,
      notes: sql<number>`count(*) filter (where ${accountingSync.attempts} = 0 and ${accountingSync.externalId} is not null and ${accountingSync.error} is not null and ${accountingSync.syncedAt} >= ${accountingSync.updatedAt})::int`,
      lastSyncAt: sql<Date | null>`max(${accountingSync.syncedAt}) filter (where ${accountingSync.externalId} is not null)`,
    })
    .from(accountingSync)
    .where(eq(accountingSync.tenantId, tenantId));
  const waiting = (await pendingItems(tenantId, conn.config.syncFrom, false)).length;

  const failRows = await db
    .select({ type: accountingSync.entityType, id: accountingSync.entityId, error: accountingSync.error, attempts: accountingSync.attempts, updatedAt: accountingSync.updatedAt })
    .from(accountingSync)
    .where(and(eq(accountingSync.tenantId, tenantId), gt(accountingSync.attempts, 0)))
    .orderBy(desc(accountingSync.updatedAt))
    .limit(25);
  const noteRows = await db
    .select({ type: accountingSync.entityType, id: accountingSync.entityId, error: accountingSync.error, attempts: accountingSync.attempts, updatedAt: accountingSync.updatedAt })
    .from(accountingSync)
    .where(and(eq(accountingSync.tenantId, tenantId), eq(accountingSync.attempts, 0), isNotNull(accountingSync.externalId), isNotNull(accountingSync.error)))
    .orderBy(desc(accountingSync.updatedAt))
    .limit(10);
  const names = await labels(tenantId, [...failRows, ...noteRows]);
  const toItem = (r: (typeof failRows)[number]): SyncListItem => {
    const l = names.get(`${r.type}:${r.id}`);
    return { type: r.type, id: r.id, label: l?.label ?? `${r.type} #${r.id}`, href: l?.href ?? "#", error: r.error ?? "", attempts: r.attempts, updatedAt: r.updatedAt };
  };
  const [by] = conn.connectedBy ? await db.select({ name: users.name }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, conn.connectedBy))) : [];
  const lastSyncAt = agg?.lastSyncAt ? new Date(agg.lastSyncAt) : null;
  return {
    ...base,
    counts: { synced: agg?.synced ?? 0, failed: agg?.failed ?? 0, notes: agg?.notes ?? 0, waiting },
    lastSyncAt,
    failures: failRows.map(toItem),
    notes: noteRows.map(toItem),
    connectedByName: by?.name ?? null,
  };
}
export type QboOverview = Awaited<ReturnType<typeof getQboOverview>>;

export type QboBadgeStatus = { state: SyncState; error: string | null; externalId: string | null; environment: QboEnvironment } | null;

/** Sync status for records (null when the shop hasn't connected QuickBooks). Batch-friendly for lists. */
export async function getQboStatuses(tenantId: number, type: SyncEntityType, ids: number[]): Promise<Map<number, QboBadgeStatus>> {
  const out = new Map<number, QboBadgeStatus>();
  if (!ids.length) return out;
  const conn = await getQboConnection(tenantId);
  if (!conn || conn.status === "disconnected") return out;
  const rows = await db
    .select({ id: accountingSync.entityId, externalId: accountingSync.externalId, syncToken: accountingSync.syncToken, syncedAt: accountingSync.syncedAt, error: accountingSync.error, attempts: accountingSync.attempts, updatedAt: accountingSync.updatedAt })
    .from(accountingSync)
    .where(and(eq(accountingSync.tenantId, tenantId), eq(accountingSync.entityType, type), inArray(accountingSync.entityId, ids)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const r = byId.get(id);
    out.set(id, { state: syncState(r), error: r?.error ?? null, externalId: r?.externalId ?? null, environment: conn.config.environment });
  }
  return out;
}
