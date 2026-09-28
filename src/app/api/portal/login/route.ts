import { headers } from "next/headers";
import { forbidden, sameOrigin } from "@/lib/http";
import { redeemPortalLink, tokensAfterSignIn } from "@/lib/portal/links";
import { cookieTokens, portalCookies } from "@/lib/portal/session";
import { isPortalToken, safePortalNext } from "@/lib/portal/tokens";

/**
 * "Sign in" button on /portal/login/<token>: use the one-time link and start a portal session.
 * (A POST, not the link itself, so email scanners that open links can't use it up.)
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const fd = await req.formData();
  const token = String(fd.get("token") ?? "");
  const next = safePortalNext(String(fd.get("next") ?? ""));
  if (!isPortalToken(token)) return redirect("/portal?expired=1");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  const session = await redeemPortalLink(token, { ip, userAgent: h.get("user-agent")?.slice(0, 300) ?? null });
  if (!session) return redirect(`/portal/login/${token}?next=${encodeURIComponent(next)}`);
  const tokens = await tokensAfterSignIn(await cookieTokens(), session.sessionToken, session.tenantId, session.customerId);
  return redirect(next, portalCookies(tokens));
}

function redirect(location: string, cookies: string[] = []) {
  const res = new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}
