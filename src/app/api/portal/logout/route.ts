import { forbidden, sameOrigin } from "@/lib/http";
import { endPortalSessions } from "@/lib/portal/links";
import { cookieTokens, portalCookies } from "@/lib/portal/session";

/** Sign out of the active customer account (or all of them with all=1). */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const fd = await req.formData();
  const tokens = await cookieTokens();
  const all = fd.get("all") === "1";
  const out = all ? tokens : tokens.slice(0, 1);
  await endPortalSessions(out);
  const rest = tokens.filter((t) => !out.includes(t));
  const res = new Response(null, { status: 303, headers: { Location: rest.length ? "/portal/home" : "/portal?signedOut=1", "Cache-Control": "no-store" } });
  for (const c of portalCookies(rest)) res.headers.append("Set-Cookie", c);
  return res;
}
