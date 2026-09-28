/**
 * Small QuickBooks Online Accounting API client (pure — fetch, clock and token storage are injected).
 *
 *   GET/POST {base}/v3/company/{realmId}/{entity}?minorversion=75
 *
 * - Refreshes the access token when it has expired, or once on a 401, through TokenStore.refresh,
 *   which saves the rotated refresh token (the server's store does it under a row lock so two
 *   syncs never spend the same refresh token).
 * - 429 (rate limit: ~500 requests/minute per company) and 5xx are retried with a short back-off.
 * - Errors become QboError with a plain-language message that is safe to show in Settings.
 */
import { QBO_MINOR_VERSION, qboApiBase, type QboAppConfig, type QboEnvironment } from "./config";
import { accessTokenExpired, QboAuthError, refreshTokens, type FetchLike, type QboTokens } from "./oauth";

export interface TokenStore {
  get(): Promise<QboTokens>;
  /**
   * Replace `stale` with fresh tokens. Implementations re-read the stored tokens first: if someone
   * else already refreshed them, return those; otherwise call doRefresh(current) and save the result.
   */
  refresh(stale: QboTokens, doRefresh: (current: QboTokens) => Promise<QboTokens>): Promise<QboTokens>;
}

export type QboErrorKind = "auth" | "reconnect" | "rate_limit" | "network" | "server" | "validation" | "stale" | "duplicate_name" | "not_found";

export class QboError extends Error {
  constructor(
    message: string,
    readonly kind: QboErrorKind,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

type FaultItem = { Message?: string; Detail?: string; code?: string; message?: string; detail?: string };
type FaultBody = { Fault?: { Error?: FaultItem[]; type?: string }; fault?: { error?: FaultItem[]; type?: string } };

const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Turn a QuickBooks Fault response into a QboError. */
export function faultToError(status: number, body: unknown): QboError {
  const f = (body ?? {}) as FaultBody;
  const e = f.Fault?.Error?.[0] ?? f.fault?.error?.[0];
  const code = e?.code;
  const msg = (e?.Message ?? e?.message ?? "").trim();
  const detail = (e?.Detail ?? e?.detail ?? "").trim();
  const said = [msg, detail && detail !== msg ? detail : ""].filter(Boolean).join(" — ");
  if (status === 401) return new QboError("QuickBooks didn't accept our sign-in. Connect to QuickBooks again in Settings → Integrations.", "auth", status, code);
  if (status === 403) return new QboError(`QuickBooks refused access${said ? `: ${clip(said)}` : ""}. The person who connected may not be an admin of this QuickBooks company, or the subscription has lapsed.`, "auth", status, code);
  if (status === 429) return new QboError("QuickBooks is limiting how fast we can send (too many requests). It will be retried on the next sync.", "rate_limit", status, code);
  if (status >= 500) return new QboError(`QuickBooks is having trouble right now (${status}). Try again in a few minutes.`, "server", status, code);
  if (code === "6240") return new QboError(`QuickBooks already has a customer, vendor or employee with that name${detail ? ` (${clip(detail, 200)})` : ""}.`, "duplicate_name", status, code);
  if (code === "5010") return new QboError("The record was changed in QuickBooks at the same time. It will be retried.", "stale", status, code);
  if (code === "610") return new QboError(`QuickBooks couldn't find the record${detail ? ` (${clip(detail, 200)})` : ""}. It may have been deleted there.`, "not_found", status, code);
  return new QboError(said ? `QuickBooks said: ${clip(said)}` : `QuickBooks returned an error (${status}).`, "validation", status, code);
}

export type QboClientOptions = {
  app: QboAppConfig;
  realmId: string;
  environment: QboEnvironment;
  tokens: TokenStore;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Retries for 429/5xx (default 2). */
  retries?: number;
};

export type QboEntity = { Id: string; SyncToken: string; [k: string]: unknown };

export class QboClient {
  private readonly fetchFn: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  /** How many API calls this client made (for tests and logging). */
  calls = 0;

  constructor(private readonly o: QboClientOptions) {
    this.fetchFn = o.fetch ?? ((u, i) => fetch(u, i));
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
  }

  private url(path: string, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ ...params, minorversion: String(QBO_MINOR_VERSION) });
    return `${qboApiBase(this.o.environment)}/v3/company/${encodeURIComponent(this.o.realmId)}/${path}?${q.toString()}`;
  }

  private async refresh(stale: QboTokens) {
    try {
      return await this.o.tokens.refresh(stale, (cur) => refreshTokens(this.fetchFn, this.o.app, cur.refreshToken, this.now()));
    } catch (e) {
      if (e instanceof QboAuthError) throw new QboError(e.message, e.reconnect ? "reconnect" : "auth");
      throw e;
    }
  }

  async request<T = Record<string, unknown>>(method: "GET" | "POST", path: string, opts: { params?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    let tokens = await this.o.tokens.get();
    if (accessTokenExpired(tokens, this.now())) tokens = await this.refresh(tokens);
    let refreshed = false;
    const maxRetries = this.o.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      this.calls++;
      try {
        res = await this.fetchFn(this.url(path, opts.params), {
          method,
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            Accept: "application/json",
            ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        if (attempt < maxRetries) {
          await this.sleep(1000 * (attempt + 1));
          continue;
        }
        throw new QboError("Couldn't reach QuickBooks (no connection). It will be retried on the next sync.", "network");
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        tokens = await this.refresh(tokens);
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const after = Number(res.headers.get("retry-after"));
        await this.sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : 2000 * (attempt + 1));
        continue;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) throw faultToError(res.status, body);
      if (body && typeof body === "object" && ("Fault" in body || "fault" in body)) throw faultToError(400, body);
      return (body ?? {}) as T;
    }
  }

  /** Run a QuickBooks query ("select * from Customer where …") and return the rows of that entity. */
  async query<T = QboEntity>(entity: string, sql: string): Promise<T[]> {
    const j = await this.request<{ QueryResponse?: Record<string, unknown> }>("GET", "query", { params: { query: sql } });
    const rows = j.QueryResponse?.[entity];
    return Array.isArray(rows) ? (rows as T[]) : [];
  }

  async read<T = QboEntity>(entity: string, id: string): Promise<T> {
    const j = await this.request<Record<string, unknown>>("GET", `${entity.toLowerCase()}/${encodeURIComponent(id)}`);
    return j[entity] as T;
  }

  /** Create, or update when body has Id + SyncToken. */
  async save<T = QboEntity>(entity: string, body: Record<string, unknown>): Promise<T> {
    const j = await this.request<Record<string, unknown>>("POST", entity.toLowerCase(), { body });
    return j[entity] as T;
  }

  /** operation=void | delete, with { Id, SyncToken }. */
  async operation<T = QboEntity>(entity: string, op: "void" | "delete", ref: { Id: string; SyncToken: string }): Promise<T> {
    const j = await this.request<Record<string, unknown>>("POST", entity.toLowerCase(), { params: { operation: op }, body: op === "void" ? { ...ref, sparse: true } : ref });
    return j[entity] as T;
  }

  async companyInfo(): Promise<{ CompanyName?: string; LegalName?: string; Country?: string }> {
    return this.read("CompanyInfo", this.o.realmId);
  }
}
