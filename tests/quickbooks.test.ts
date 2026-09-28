import { test } from "node:test";
import assert from "node:assert/strict";
import { QboClient, QboError, type TokenStore } from "../src/lib/accounting/quickbooks/client";
import { QboSyncEngine, type SyncStore } from "../src/lib/accounting/quickbooks/engine";
import {
  customerBody,
  escapeQbo,
  invoiceBody,
  lineQtyPrice,
  paymentBody,
  qboCustomerQuery,
  qboDisplayName,
  totalMismatch,
  type LocalCustomer,
  type LocalInvoice,
  type LocalPayment,
} from "../src/lib/accounting/quickbooks/mapping";
import { authorizeUrl, exchangeCode, QboAuthError, signState, verifyState, type QboTokens } from "../src/lib/accounting/quickbooks/oauth";
import { syncState, type SyncEntityType, type SyncRow } from "../src/lib/accounting/quickbooks/status";
import { qboAppConfig } from "../src/lib/accounting/quickbooks/config";

const APP = { clientId: "cid", clientSecret: "csecret", environment: "sandbox" as const };
const NOW = Date.parse("2026-09-28T15:00:00Z");

// ---------------------------------------------------------------------------
// A fake QuickBooks: route handlers by "METHOD path", every call recorded.
// ---------------------------------------------------------------------------
type Call = { method: string; path: string; params: URLSearchParams; body: Record<string, unknown> | null; auth: string | null };
type Handler = (c: Call) => { status?: number; json?: unknown; headers?: Record<string, string> } | undefined;

function fakeQbo(handler: Handler) {
  const calls: Call[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const raw = typeof init?.body === "string" ? init.body : null;
    let body: Record<string, unknown> | null = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = Object.fromEntries(new URLSearchParams(raw));
      }
    }
    const path = u.pathname.replace(/^\/v3\/company\/[^/]+\//, "");
    const call: Call = { method: init?.method ?? "GET", path, params: u.searchParams, body, auth: new Headers(init?.headers).get("authorization") };
    calls.push(call);
    const r = handler(call) ?? { status: 404, json: { Fault: { Error: [{ Message: `no mock for ${call.method} ${path}` }] } } };
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  };
  return { calls, fetchFn };
}

function memTokens(initial: QboTokens) {
  const saved: QboTokens[] = [];
  let cur = initial;
  const store: TokenStore = {
    get: async () => cur,
    refresh: async (_stale, doRefresh) => {
      cur = await doRefresh(cur);
      saved.push(cur);
      return cur;
    },
  };
  return { store, saved, current: () => cur };
}

const freshTokens = (): QboTokens => ({ accessToken: "at-1", refreshToken: "rt-1", expiresAt: NOW + 3600_000, refreshExpiresAt: NOW + 100 * 86400_000 });

function client(handler: Handler, tokens = memTokens(freshTokens())) {
  const q = fakeQbo(handler);
  const sleeps: number[] = [];
  const c = new QboClient({ app: APP, realmId: "9130", environment: "sandbox", tokens: tokens.store, fetch: q.fetchFn, now: () => NOW, sleep: async (ms) => void sleeps.push(ms) });
  return { c, calls: q.calls, tokens, sleeps };
}

class MemStore implements SyncStore {
  customers = new Map<number, LocalCustomer>();
  invoices = new Map<number, LocalInvoice>();
  payments = new Map<number, LocalPayment>();
  rows = new Map<string, SyncRow>();
  clock = NOW;
  private tick() {
    return new Date((this.clock += 1000));
  }
  async loadCustomer(id: number) {
    return this.customers.get(id) ?? null;
  }
  async loadInvoice(id: number) {
    return this.invoices.get(id) ?? null;
  }
  async loadPayment(id: number) {
    return this.payments.get(id) ?? null;
  }
  async getRow(t: SyncEntityType, id: number) {
    return this.rows.get(`${t}:${id}`) ?? null;
  }
  row(t: SyncEntityType, id: number) {
    return this.rows.get(`${t}:${id}`);
  }
  async saveSuccess(t: SyncEntityType, id: number, r: { externalId: string; syncToken: string | null; warning?: string | null }) {
    const now = this.tick();
    this.rows.set(`${t}:${id}`, { externalId: r.externalId, syncToken: r.syncToken, syncedAt: now, updatedAt: now, error: r.warning ?? null, attempts: 0 });
  }
  async saveSkipped(t: SyncEntityType, id: number, reason: string) {
    const now = this.tick();
    const prev = this.row(t, id);
    this.rows.set(`${t}:${id}`, { externalId: prev?.externalId ?? null, syncToken: prev?.syncToken ?? null, syncedAt: now, updatedAt: now, error: reason, attempts: 0 });
  }
  async saveFailure(t: SyncEntityType, id: number, error: string) {
    const prev = this.row(t, id);
    this.rows.set(`${t}:${id}`, { externalId: prev?.externalId ?? null, syncToken: prev?.syncToken ?? null, syncedAt: prev?.syncedAt ?? null, updatedAt: this.tick(), error, attempts: (prev?.attempts ?? 0) + 1 });
  }
}

const acme: LocalCustomer = { id: 1, name: "Bob's Plumbing: Hammond", isCompany: true, email: "bob@example.com", phone: "219-555-0100", website: null, address: "12 Main St", city: "Hammond", state: "IN", zip: "46320", billingAddress: null, taxExempt: false };
const inv7001: LocalInvoice = {
  id: 10,
  number: 7001,
  customerId: 1,
  status: "sent",
  issueDate: "2026-09-28",
  dueDate: "2026-10-28",
  poNumber: "PO-55",
  notes: null,
  taxCents: 175,
  totalCents: 10175,
  items: [
    { description: "Business cards 3.5×2", quantity: 500, amountCents: 7500, taxable: true },
    { description: "Design fee", quantity: 1, amountCents: 2500, taxable: false },
  ],
};
const pay1: LocalPayment = { id: 20, invoiceId: 10, customerId: 1, amountCents: 5000, method: "check", reference: "1042", receivedOn: "2026-09-29", notes: null, voidedAt: null };

function storeWithData() {
  const s = new MemStore();
  s.customers.set(1, { ...acme });
  s.invoices.set(10, structuredClone(inv7001));
  s.payments.set(20, { ...pay1 });
  return s;
}

/** A QuickBooks company where the customer, item and income account don't exist yet. */
function emptyCompany(opts: { invoiceTotal?: number } = {}) {
  let nextId = 100;
  const created: Record<string, Record<string, unknown>[]> = {};
  const handler: Handler = (c) => {
    if (c.method === "GET" && c.path === "query") {
      const q = c.params.get("query") ?? "";
      if (q.includes("from Account")) return { json: { QueryResponse: { Account: [{ Id: "79", Name: "Sales", AccountType: "Income" }] } } };
      if (q.includes("from PaymentMethod")) return { json: { QueryResponse: { PaymentMethod: [{ Id: "1", Name: "Cash" }, { Id: "2", Name: "Check" }] } } };
      return { json: { QueryResponse: {} } };
    }
    if (c.method === "POST") {
      const entity = c.path[0]!.toUpperCase() + c.path.slice(1);
      (created[entity] ??= []).push(c.body!);
      const op = c.params.get("operation");
      const Id = (c.body!.Id as string) ?? String(nextId++);
      const extra = entity === "Invoice" ? { TotalAmt: opts.invoiceTotal ?? 101.75 } : {};
      return { json: { [entity]: { ...c.body, Id, SyncToken: op ? "9" : c.body!.SyncToken ? String(Number(c.body!.SyncToken) + 1) : "0", ...extra } } };
    }
    return undefined;
  };
  return { handler, created };
}

// ---------------------------------------------------------------------------
test("OAuth state: signed, expiring, bound to user, shop and browser nonce", () => {
  const key = "k";
  const s = signState({ tenantId: 1, userId: 7, nonce: "n1", exp: NOW + 600_000 }, key);
  const expect = { tenantId: 1, userId: 7, nonce: "n1" };
  assert.deepEqual(verifyState(s, key, expect, NOW), { ok: true, state: { tenantId: 1, userId: 7, nonce: "n1", exp: NOW + 600_000 } });
  assert.deepEqual(verifyState(s, key, expect, NOW + 600_001), { ok: false, reason: "expired" });
  assert.deepEqual(verifyState(s, "other-key", expect, NOW), { ok: false, reason: "invalid" });
  assert.deepEqual(verifyState(s, key, { ...expect, tenantId: 2 }, NOW), { ok: false, reason: "mismatch" });
  assert.deepEqual(verifyState(s, key, { ...expect, userId: 8 }, NOW), { ok: false, reason: "mismatch" });
  assert.deepEqual(verifyState(s, key, { ...expect, nonce: "other" }, NOW), { ok: false, reason: "mismatch" });
  assert.deepEqual(verifyState(s, key, { ...expect, nonce: undefined }, NOW), { ok: false, reason: "mismatch" });
  // Tampering with the payload (e.g. switching the shop) breaks the signature.
  const [payload, sig] = s.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, "base64url").toString()), t: 2 })).toString("base64url");
  assert.deepEqual(verifyState(`${forged}.${sig}`, key, { ...expect, tenantId: 2 }, NOW), { ok: false, reason: "invalid" });
  assert.deepEqual(verifyState(null, key, expect, NOW), { ok: false, reason: "invalid" });
  assert.deepEqual(verifyState("garbage", key, expect, NOW), { ok: false, reason: "invalid" });

  const url = new URL(authorizeUrl(APP, "https://app.example.com/api/quickbooks/callback", s));
  assert.equal(url.origin + url.pathname, "https://appcenter.intuit.com/connect/oauth2");
  assert.equal(url.searchParams.get("scope"), "com.intuit.quickbooks.accounting");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), "https://app.example.com/api/quickbooks/callback");
  assert.equal(url.searchParams.get("state"), s);
});

test("app config comes from env; environment defaults to production", () => {
  assert.equal(qboAppConfig({}), null);
  assert.equal(qboAppConfig({ QUICKBOOKS_CLIENT_ID: "a" }), null);
  assert.deepEqual(qboAppConfig({ QUICKBOOKS_CLIENT_ID: "a", QUICKBOOKS_CLIENT_SECRET: "b" }), { clientId: "a", clientSecret: "b", environment: "production" });
  assert.equal(qboAppConfig({ QUICKBOOKS_CLIENT_ID: "a", QUICKBOOKS_CLIENT_SECRET: "b", QUICKBOOKS_ENVIRONMENT: "Sandbox" })!.environment, "sandbox");
});

test("code exchange: Basic auth, form body, tokens with expiry; invalid_grant is a clear error", async () => {
  const q = fakeQbo((c) =>
    c.body?.code === "good"
      ? { json: { access_token: "A", refresh_token: "R", expires_in: 3600, x_refresh_token_expires_in: 8726400, token_type: "bearer" } }
      : { status: 400, json: { error: "invalid_grant" } },
  );
  const t = await exchangeCode(q.fetchFn, APP, "good", "https://x/cb", NOW);
  assert.deepEqual(t, { accessToken: "A", refreshToken: "R", expiresAt: NOW + 3600_000, refreshExpiresAt: NOW + 8726400_000 });
  assert.equal(q.calls[0]!.auth, `Basic ${Buffer.from("cid:csecret").toString("base64")}`);
  assert.deepEqual(q.calls[0]!.body, { grant_type: "authorization_code", code: "good", redirect_uri: "https://x/cb" });
  await assert.rejects(exchangeCode(q.fetchFn, APP, "used", "https://x/cb", NOW), (e) => e instanceof QboAuthError && /already used or expired/.test(e.message));
});

test("client refreshes an expired access token first and saves the rotated refresh token", async () => {
  const tokens = memTokens({ ...freshTokens(), expiresAt: NOW - 1 });
  const { c, calls } = client((call) => {
    if (call.path.includes("tokens/bearer")) return { json: { access_token: "at-2", refresh_token: "rt-2", expires_in: 3600, x_refresh_token_expires_in: 8726400 } };
    if (call.path.startsWith("companyinfo")) return { json: { CompanyInfo: { CompanyName: "Miss Print LLC", Country: "US" } } };
    return undefined;
  }, tokens);
  const info = await c.companyInfo();
  assert.equal(info.CompanyName, "Miss Print LLC");
  assert.equal(calls[0]!.body!.grant_type, "refresh_token");
  assert.equal(calls[0]!.body!.refresh_token, "rt-1");
  assert.equal(calls[1]!.auth, "Bearer at-2");
  assert.equal(calls[1]!.params.get("minorversion"), "75");
  assert.equal(tokens.saved.length, 1);
  assert.equal(tokens.saved[0]!.refreshToken, "rt-2", "rotated refresh token is saved");
});

test("client retries once after a 401 with refreshed tokens; a dead refresh token asks to reconnect", async () => {
  let n = 0;
  const { c, calls, tokens } = client((call) => {
    if (call.path.includes("tokens/bearer")) return { json: { access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 } };
    if (call.path === "customer/5") return call.auth === "Bearer at-2" ? { json: { Customer: { Id: "5", SyncToken: "3" } } } : { status: 401, json: { fault: { error: [{ message: "AuthenticationFailed", code: "3200" }] } } };
    n++;
    return undefined;
  });
  const cust = await c.read("Customer", "5");
  assert.equal(cust.SyncToken, "3");
  assert.equal(calls.length, 3);
  assert.equal(tokens.current().refreshToken, "rt-2");
  assert.equal(n, 0);

  const dead = client((call) => (call.path.includes("tokens/bearer") ? { status: 400, json: { error: "invalid_grant" } } : { status: 401, json: {} }));
  await assert.rejects(dead.c.read("Customer", "5"), (e) => e instanceof QboError && e.kind === "reconnect" && /Connect to QuickBooks again/.test(e.message));
});

test("client backs off on 429 and gives a clear rate-limit message when it persists", async () => {
  let hits = 0;
  const ok = client(() => (++hits < 2 ? { status: 429, json: {}, headers: { "retry-after": "3" } } : { json: { QueryResponse: { Item: [{ Id: "1", SyncToken: "0" }] } } }));
  assert.equal((await ok.c.query("Item", "select * from Item")).length, 1);
  assert.deepEqual(ok.sleeps, [3000]);

  const busy = client(() => ({ status: 429, json: {} }));
  await assert.rejects(busy.c.query("Item", "select * from Item"), (e) => e instanceof QboError && e.kind === "rate_limit" && /too many requests/.test(e.message));
  assert.equal(busy.calls.length, 3);
});

test("DisplayName cleanup and query escaping", () => {
  assert.equal(escapeQbo("Bob's \\ Shop"), "Bob\\'s \\\\ Shop");
  assert.equal(qboDisplayName("  Bob's Plumbing:\tHammond \n"), "Bob's Plumbing - Hammond");
  assert.equal(qboDisplayName("   ", 42), "Customer 42");
  assert.equal(qboDisplayName("x".repeat(600)).length, 500);
  assert.equal(qboCustomerQuery("Bob's Plumbing"), "select * from Customer where DisplayName = 'Bob\\'s Plumbing' and Active in (true, false)");
});

test("customer mapping", () => {
  assert.deepEqual(customerBody(acme), {
    DisplayName: "Bob's Plumbing - Hammond",
    CompanyName: "Bob's Plumbing: Hammond",
    PrimaryEmailAddr: { Address: "bob@example.com" },
    PrimaryPhone: { FreeFormNumber: "219-555-0100" },
    BillAddr: { Line1: "12 Main St", City: "Hammond", CountrySubDivisionCode: "IN", PostalCode: "46320" },
  });
  const person = customerBody({ ...acme, isCompany: false, email: null, phone: null, billingAddress: "Attn: Jo\n1 Elm St\nMunster, IN 46321" });
  assert.equal(person.CompanyName, undefined);
  assert.deepEqual(person.BillAddr, { Line1: "Attn: Jo", Line2: "1 Elm St", Line3: "Munster, IN 46321" });
});

test("invoice mapping: DocNumber, dates, lines, qty/price, tax codes, PO", () => {
  const body = invoiceBody(inv7001, { customerRef: "58", itemRef: { value: "3", name: "Printing & Services" }, customerTaxExempt: false, usTaxCodes: true, customerEmail: "bob@example.com" });
  assert.equal(body.DocNumber, "INV-7001");
  assert.equal(body.TxnDate, "2026-09-28");
  assert.equal(body.DueDate, "2026-10-28");
  assert.deepEqual(body.CustomerRef, { value: "58" });
  assert.deepEqual(body.CustomerMemo, { value: "PO PO-55" });
  assert.deepEqual(body.BillEmail, { Address: "bob@example.com" });
  assert.deepEqual(body.Line, [
    { DetailType: "SalesItemLineDetail", Amount: 75, Description: "Business cards 3.5×2", SalesItemLineDetail: { ItemRef: { value: "3", name: "Printing & Services" }, Qty: 500, UnitPrice: 0.15, TaxCodeRef: { value: "TAX" } } },
    { DetailType: "SalesItemLineDetail", Amount: 25, Description: "Design fee", SalesItemLineDetail: { ItemRef: { value: "3", name: "Printing & Services" }, Qty: 1, UnitPrice: 25, TaxCodeRef: { value: "NON" } } },
  ]);
  // No tax charged (exempt customer / zero tax) → every line NON, so QuickBooks doesn't add tax we didn't charge.
  const exempt = invoiceBody({ ...inv7001, taxCents: 0 }, { customerRef: "58", itemRef: { value: "3" }, customerTaxExempt: true, usTaxCodes: true });
  assert.deepEqual((exempt.Line as { SalesItemLineDetail: { TaxCodeRef: unknown } }[]).map((l) => l.SalesItemLineDetail.TaxCodeRef), [{ value: "NON" }, { value: "NON" }]);
  // Non-US companies: leave tax codes to QuickBooks.
  const intl = invoiceBody(inv7001, { customerRef: "58", itemRef: { value: "3" }, customerTaxExempt: false, usTaxCodes: false });
  assert.equal((intl.Line as { SalesItemLineDetail: { TaxCodeRef?: unknown } }[])[0]!.SalesItemLineDetail.TaxCodeRef, undefined);
  // $100 for 3: no exact unit price → Qty 1 with the quantity in the description.
  assert.deepEqual(lineQtyPrice(3, 10000), { Qty: 1, UnitPrice: 100, qtyInDescription: true });
  assert.deepEqual(lineQtyPrice(250, 4999), { Qty: 250, UnitPrice: 0.19996, qtyInDescription: false });
  assert.deepEqual(lineQtyPrice(0, 500), { Qty: 1, UnitPrice: 5, qtyInDescription: false });
  assert.equal(totalMismatch(10175, 101.75), null);
  assert.match(totalMismatch(10175, 102.5)!, /QuickBooks total is \$102\.50 but ours is \$101\.75/);
});

test("payment mapping links the invoice", () => {
  assert.deepEqual(paymentBody(pay1, { customerRef: "58", invoiceRef: "130", paymentMethodRef: "2" }), {
    CustomerRef: { value: "58" },
    TotalAmt: 50,
    TxnDate: "2026-09-29",
    Line: [{ Amount: 50, LinkedTxn: [{ TxnId: "130", TxnType: "Invoice" }] }],
    PaymentMethodRef: { value: "2" },
    PaymentRefNum: "1042",
  });
});

test("sync: new customer, service item and invoice are created in order; results recorded", async () => {
  const qbo = emptyCompany();
  const { c, calls } = client(qbo.handler);
  const store = storeWithData();
  const engine = new QboSyncEngine(c, store, { usTaxCodes: true, syncFrom: "2026-09-01" });
  const r = await engine.syncInvoice(10);
  assert.ok(r.ok && "externalId" in r);
  assert.deepEqual(
    calls.map((x) => `${x.method} ${x.path}${x.params.get("query") ? ` ${x.params.get("query")!.replace(/ where.*/, "")}` : ""}`),
    ["GET query select * from Customer", "POST customer", "GET query select * from Item", "GET query select * from Account", "POST item", "GET query select * from Invoice", "POST invoice"],
  );
  assert.equal(calls[0]!.params.get("query"), "select * from Customer where DisplayName = 'Bob\\'s Plumbing - Hammond' and Active in (true, false)");
  assert.deepEqual(qbo.created.Item![0], { Name: "Printing & Services", Type: "Service", IncomeAccountRef: { value: "79" } });
  const invBody = qbo.created.Invoice![0]!;
  assert.deepEqual(invBody.CustomerRef, { value: "100" });
  assert.equal(invBody.DocNumber, "INV-7001");
  assert.equal(syncState(store.row("customer", 1)), "synced");
  assert.equal(store.row("customer", 1)!.externalId, "100");
  assert.equal(syncState(store.row("invoice", 10)), "synced");
  assert.equal(store.row("invoice", 10)!.syncToken, "0");

  // Second invoice sync (e.g. after a change) updates with Id + SyncToken and doesn't touch the customer.
  calls.length = 0;
  await engine.syncInvoice(10);
  assert.deepEqual(calls.map((x) => `${x.method} ${x.path}`), ["POST invoice"]);
  assert.equal(calls[0]!.body!.Id, store.row("invoice", 10)!.externalId);
  assert.equal(calls[0]!.body!.SyncToken, "0");
  assert.equal(calls[0]!.body!.sparse, true);
});

test("sync: an existing QuickBooks customer with the same name is linked, not duplicated", async () => {
  const { c, calls } = client((call) =>
    call.path === "query" ? { json: { QueryResponse: { Customer: [{ Id: "58", SyncToken: "4", DisplayName: "Bob's Plumbing - Hammond", Active: true }] } } } : undefined,
  );
  const store = storeWithData();
  const r = await new QboSyncEngine(c, store, { usTaxCodes: true }).syncCustomer(1);
  assert.deepEqual(r, { ok: true, externalId: "58", warning: undefined });
  assert.equal(calls.length, 1, "no create call");
  assert.equal(store.row("customer", 1)!.syncToken, "4");
});

test("sync: name taken by a vendor → customer created with a (customer) suffix", async () => {
  let creates = 0;
  const { c } = client((call) => {
    if (call.path === "query") return { json: { QueryResponse: {} } };
    if (call.path === "customer") {
      creates++;
      if (creates === 1) return { status: 400, json: { Fault: { Error: [{ Message: "Duplicate Name Exists Error", Detail: "The name supplied already exists. : Another customer, vendor or employee is already using this name.", code: "6240" }], type: "ValidationFault" } } };
      return { json: { Customer: { ...call.body, Id: "77", SyncToken: "0" } } };
    }
    return undefined;
  });
  const store = storeWithData();
  const r = await new QboSyncEngine(c, store, { usTaxCodes: true }).syncCustomer(1);
  assert.ok(r.ok && "externalId" in r && r.externalId === "77");
});

test("sync: payment is linked to its invoice (invoice sent first) with the matching payment method", async () => {
  const qbo = emptyCompany();
  const { c } = client(qbo.handler);
  const store = storeWithData();
  const r = await new QboSyncEngine(c, store, { usTaxCodes: true }).syncPayment(20);
  assert.ok(r.ok && "externalId" in r);
  const invId = store.row("invoice", 10)!.externalId!;
  const body = qbo.created.Payment![0]!;
  assert.deepEqual(body.Line, [{ Amount: 50, LinkedTxn: [{ TxnId: invId, TxnType: "Invoice" }] }]);
  assert.deepEqual(body.PaymentMethodRef, { value: "2" });
  assert.deepEqual(body.CustomerRef, { value: store.row("customer", 1)!.externalId });
});

test("sync: QuickBooks tax total differs → sent with a note", async () => {
  const qbo = emptyCompany({ invoiceTotal: 102.5 });
  const { c } = client(qbo.handler);
  const store = storeWithData();
  const r = await new QboSyncEngine(c, store, { usTaxCodes: true }).syncInvoice(10);
  assert.ok(r.ok && "externalId" in r && /QuickBooks total is \$102\.50/.test(r.warning ?? ""));
  assert.equal(syncState(store.row("invoice", 10)), "warning");
});

test("sync: voids — invoice uses operation=void; payment falls back to delete; unsent voids aren't sent", async () => {
  const qbo = emptyCompany();
  let refuseVoid = true;
  const { c, calls } = client((call) => {
    if (call.path === "payment" && call.params.get("operation") === "void" && refuseVoid)
      return { status: 400, json: { Fault: { Error: [{ Message: "Operation not supported", code: "6000" }], type: "ValidationFault" } } };
    if (call.method === "GET" && call.path.startsWith("payment/")) return { json: { Payment: { Id: call.path.split("/")[1], SyncToken: "1" } } };
    return qbo.handler(call);
  });
  const store = storeWithData();
  const engine = new QboSyncEngine(c, store, { usTaxCodes: true });
  await engine.syncPayment(20);
  const payQbo = store.row("payment", 20)!.externalId!;

  store.payments.get(20)!.voidedAt = new Date();
  calls.length = 0;
  const pv = await engine.syncPayment(20);
  assert.ok(pv.ok);
  assert.deepEqual(
    calls.map((x) => `${x.method} ${x.path} ${x.params.get("operation") ?? ""}`.trim()),
    ["POST payment void", `GET payment/${payQbo}`, "POST payment delete"],
  );
  assert.deepEqual(calls[2]!.body, { Id: payQbo, SyncToken: "1" });

  const invRow = store.row("invoice", 10)!;
  store.invoices.get(10)!.status = "void";
  calls.length = 0;
  await engine.syncInvoice(10);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.params.get("operation"), "void");
  assert.deepEqual(calls[0]!.body, { Id: invRow.externalId, SyncToken: invRow.syncToken, sparse: true });
  assert.equal(syncState(store.row("invoice", 10)), "synced");

  // Never sent, then voided: nothing goes to QuickBooks.
  const fresh = storeWithData();
  fresh.invoices.get(10)!.status = "void";
  calls.length = 0;
  const skipped = await new QboSyncEngine(c, fresh, { usTaxCodes: true }).syncInvoice(10);
  assert.deepEqual(skipped, { ok: true, skipped: "Voided before it was sent to QuickBooks." });
  assert.equal(calls.length, 0);
  assert.equal(syncState(fresh.row("invoice", 10)), "skipped");
  refuseVoid = false;
});

test("sync: invoices dated before the start date aren't sent (nor their payments)", async () => {
  const { c, calls } = client(emptyCompany().handler);
  const store = storeWithData();
  const engine = new QboSyncEngine(c, store, { usTaxCodes: true, syncFrom: "2026-10-01" });
  const r = await engine.syncPayment(20);
  assert.ok(r.ok && "skipped" in r && /before 2026-10-01/.test(r.skipped));
  assert.equal(calls.length, 0);
});

test("sync: errors are recorded with a clear message, on the record and on what depended on it", async () => {
  const { c } = client((call) => {
    if (call.path === "query") return { json: { QueryResponse: {} } };
    if (call.path === "customer")
      return { status: 400, json: { Fault: { Error: [{ Message: "Invalid Email Address format", Detail: "Email Address does not conform to the syntax rules", code: "6000" }], type: "ValidationFault" } } };
    return undefined;
  });
  const store = storeWithData();
  const r = await new QboSyncEngine(c, store, { usTaxCodes: true }).syncPayment(20);
  assert.equal(r.ok, false);
  const cust = store.row("customer", 1)!;
  assert.equal(syncState(cust), "failed");
  assert.equal(cust.error, "QuickBooks said: Invalid Email Address format — Email Address does not conform to the syntax rules");
  assert.match(store.row("invoice", 10)!.error!, /^The customer couldn't be sent to QuickBooks: QuickBooks said: Invalid Email/);
  assert.match(store.row("payment", 20)!.error!, /^Its invoice couldn't be sent to QuickBooks:/);
  assert.equal(store.row("payment", 20)!.attempts, 1);

  // Unreachable QuickBooks: network error after retries, recorded and counted.
  const down = new QboClient({ app: APP, realmId: "1", environment: "sandbox", tokens: memTokens(freshTokens()).store, now: () => NOW, sleep: async () => {}, fetch: async () => { throw new TypeError("fetch failed"); } });
  const r2 = await new QboSyncEngine(down, store, { usTaxCodes: true }).syncCustomer(1);
  assert.deepEqual(r2, { ok: false, error: "Couldn't reach QuickBooks (no connection). It will be retried on the next sync.", reconnect: false, kind: "network" });
  assert.equal(store.row("customer", 1)!.attempts, 2);
});

test("sync: an id that isn't this shop's is 'not found' and nothing is written", async () => {
  const { c, calls } = client(emptyCompany().handler);
  const store = storeWithData();
  const engine = new QboSyncEngine(c, store, { usTaxCodes: true });
  assert.deepEqual(await engine.syncInvoice(999), { ok: true, skipped: "Invoice not found." });
  assert.deepEqual(await engine.syncPayment(999), { ok: true, skipped: "Payment not found." });
  assert.equal(store.rows.size, 0);
  assert.equal(calls.length, 0);
});

test("sync: a failed customer isn't retried again by every record that needs it in the same run", async () => {
  let customerCreates = 0;
  const { c } = client((call) => {
    if (call.path === "query") return { json: { QueryResponse: {} } };
    if (call.path === "customer") {
      customerCreates++;
      return { status: 400, json: { Fault: { Error: [{ Message: "Invalid Email Address format", code: "6000" }] } } };
    }
    return undefined;
  });
  const store = storeWithData();
  store.payments.set(21, { ...pay1, id: 21 });
  const engine = new QboSyncEngine(c, store, { usTaxCodes: true });
  await engine.syncInvoice(10);
  await engine.syncPayment(20);
  await engine.syncPayment(21);
  assert.equal(customerCreates, 1);
  assert.equal(store.row("customer", 1)!.attempts, 1);
  assert.equal(syncState(store.row("payment", 21)), "failed");
});

test("sync state from an accounting_sync row", () => {
  const t = new Date(NOW);
  const later = new Date(NOW + 5);
  const base: SyncRow = { externalId: "1", syncToken: "0", syncedAt: t, updatedAt: t, error: null, attempts: 0 };
  assert.equal(syncState(null), "none");
  assert.equal(syncState(base), "synced");
  assert.equal(syncState({ ...base, error: "note" }), "warning");
  assert.equal(syncState({ ...base, updatedAt: later }), "pending");
  assert.equal(syncState({ ...base, syncedAt: null }), "pending");
  assert.equal(syncState({ ...base, attempts: 2, error: "x" }), "failed");
  assert.equal(syncState({ ...base, externalId: null, error: "Voided before it was sent" }), "skipped");
});
