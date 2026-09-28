import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { appUrl } from "@/lib/http";
import { secretsConfigured } from "@/lib/secrets";
import { qboAppConfig } from "@/lib/accounting/quickbooks/config";
import { authorizeUrl, newNonce, signState, STATE_TTL_MS } from "@/lib/accounting/quickbooks/oauth";
import { oauthStateKey } from "@/lib/accounting/quickbooks/server";

const QBO_NONCE_COOKIE = "mp_qbo_nonce";

/** Start connecting this shop's QuickBooks Online company (Settings → Integrations → Connect). */
export async function GET() {
  const base = await appUrl();
  const back = (reason: string) => NextResponse.redirect(`${base}/settings/integrations?quickbooks=error&reason=${reason}`);
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${base}/login?next=${encodeURIComponent("/settings/integrations")}`);
  if (!can(user.role, "settings.manage")) return back("forbidden");
  const app = qboAppConfig();
  if (!app) return back("not_configured");
  if (!secretsConfigured()) return back("secrets");

  const nonce = newNonce();
  const state = signState({ tenantId: user.tenantId, userId: user.id, nonce, exp: Date.now() + STATE_TTL_MS }, oauthStateKey());
  const res = NextResponse.redirect(authorizeUrl(app, `${base}/api/quickbooks/callback`, state));
  res.cookies.set(QBO_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax", // sent on the top-level redirect back from Intuit
    secure: base.startsWith("https://"),
    path: "/api/quickbooks",
    maxAge: STATE_TTL_MS / 1000,
  });
  return res;
}
