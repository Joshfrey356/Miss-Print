/**
 * QuickBooks Online settings that come from the server's environment (pure — safe to unit test).
 *
 * The platform owner creates ONE Intuit developer app and sets:
 *   QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, QUICKBOOKS_ENVIRONMENT (production | sandbox; default production)
 * with the app's redirect URI set to <APP_URL>/api/quickbooks/callback. Each shop then connects its own
 * QuickBooks Online company (OAuth 2.0); the tokens are stored per shop in tenant_integrations.
 *
 * QuickBooks Desktop is not supported — it has no cloud API like this.
 */
export type QboEnvironment = "production" | "sandbox";

export const QBO_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const QBO_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
export const QBO_SCOPE = "com.intuit.quickbooks.accounting";
/** Accounting API minor version sent with every request. */
export const QBO_MINOR_VERSION = 75;

/**
 * Outside production, QUICKBOOKS_API_BASE / QUICKBOOKS_TOKEN_URL can point at a local mock server
 * for end-to-end testing. They are ignored in production.
 */
const devOverride = (name: string) => (process.env.NODE_ENV !== "production" ? process.env[name]?.trim().replace(/\/+$/, "") || null : null);

export const qboApiBase = (env: QboEnvironment) =>
  devOverride("QUICKBOOKS_API_BASE") ?? (env === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com");

export const qboTokenUrl = () => devOverride("QUICKBOOKS_TOKEN_URL") ?? QBO_TOKEN_URL;

const envVal = (name: string, env: Record<string, string | undefined>) => env[name]?.trim() || "";

export type QboAppConfig = { clientId: string; clientSecret: string; environment: QboEnvironment };

/** The Intuit app keys, or null when this server isn't set up for QuickBooks. */
export function qboAppConfig(env: Record<string, string | undefined> = process.env): QboAppConfig | null {
  const clientId = envVal("QUICKBOOKS_CLIENT_ID", env);
  const clientSecret = envVal("QUICKBOOKS_CLIENT_SECRET", env);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, environment: qboEnvironment(env) };
}

export function qboEnvironment(env: Record<string, string | undefined> = process.env): QboEnvironment {
  return envVal("QUICKBOOKS_ENVIRONMENT", env).toLowerCase() === "sandbox" ? "sandbox" : "production";
}

/** Link to the QuickBooks web app for a record, so people can jump straight to it. */
export function qboAppLink(env: QboEnvironment, kind: "customer" | "invoice" | "payment", id: string) {
  const host = env === "sandbox" ? "https://app.sandbox.qbo.intuit.com" : "https://app.qbo.intuit.com";
  const path = kind === "customer" ? "customerdetail" : kind === "invoice" ? "invoice" : "recvpayment";
  return `${host}/app/${path}?${kind === "customer" ? "nameId" : "txnId"}=${encodeURIComponent(id)}`;
}
