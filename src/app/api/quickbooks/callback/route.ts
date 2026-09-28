import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { appUrl } from "@/lib/http";
import { secretsConfigured } from "@/lib/secrets";
import { qboAppConfig } from "@/lib/accounting/quickbooks/config";
import { QboClient } from "@/lib/accounting/quickbooks/client";
import { exchangeCode, QboAuthError, verifyState, type QboTokens } from "@/lib/accounting/quickbooks/oauth";
import { oauthStateKey, saveQboConnection } from "@/lib/accounting/quickbooks/server";

const NONCE_COOKIE = "mp_qbo_nonce";

/** Intuit sends the person back here after they approve (or cancel) the connection. */
export async function GET(req: NextRequest) {
  const base = await appUrl();
  const p = req.nextUrl.searchParams;
  const done = (query: string) => {
    const res = NextResponse.redirect(`${base}/settings/integrations?${query}`);
    res.cookies.set(NONCE_COOKIE, "", { httpOnly: true, path: "/api/quickbooks", maxAge: 0 });
    return res;
  };
  const fail = (reason: string) => done(`quickbooks=error&reason=${reason}`);

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${base}/login?next=${encodeURIComponent("/settings/integrations")}`);
  if (!can(user.role, "settings.manage")) return fail("forbidden");
  if (p.get("error")) return fail(p.get("error") === "access_denied" ? "denied" : "failed");
  const app = qboAppConfig();
  if (!app) return fail("not_configured");
  if (!secretsConfigured()) return fail("secrets");

  const check = verifyState(p.get("state"), oauthStateKey(), { tenantId: user.tenantId, userId: user.id, nonce: req.cookies.get(NONCE_COOKIE)?.value });
  if (!check.ok) return fail(check.reason === "expired" ? "expired" : "state");
  const code = p.get("code");
  const realmId = p.get("realmId");
  if (!code || !realmId || !/^\d{1,30}$/.test(realmId)) return fail("failed");

  let tokens: QboTokens;
  try {
    tokens = await exchangeCode((u, i) => fetch(u, i), app, code, `${base}/api/quickbooks/callback`);
  } catch (e) {
    console.error("[quickbooks] code exchange failed", e instanceof QboAuthError ? e.message : e);
    return fail("exchange");
  }

  // The company's name (for Settings) and country (US companies get TAX/NON tax codes). Not fatal if it fails.
  let companyName: string | null = null;
  let country: string | null = null;
  try {
    const client = new QboClient({ app, realmId, environment: app.environment, tokens: { get: async () => tokens, refresh: async () => tokens } });
    const info = await client.companyInfo();
    companyName = info?.CompanyName ?? info?.LegalName ?? null;
    country = info?.Country ?? null;
  } catch (e) {
    console.error("[quickbooks] couldn't read company info", e);
  }

  try {
    await saveQboConnection(user.tenantId, user, { realmId, companyName, country, environment: app.environment, tokens });
  } catch (e) {
    console.error("[quickbooks] couldn't save connection", e);
    return fail("save");
  }
  return done("quickbooks=connected");
}
