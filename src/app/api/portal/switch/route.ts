import { forbidden, sameOrigin } from "@/lib/http";
import { cookieTokens, portalCookies } from "@/lib/portal/session";
import { hashPortalToken } from "@/lib/portal/tokens";

/** Switch the active customer account in this browser (only between accounts it's already signed in to). */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const fd = await req.formData();
  const to = String(fd.get("to") ?? "");
  const tokens = await cookieTokens();
  const pick = /^[a-f0-9]{16,64}$/.test(to) ? tokens.find((t) => hashPortalToken(t).startsWith(to)) : undefined;
  const ordered = pick ? [pick, ...tokens.filter((t) => t !== pick)] : tokens;
  const res = new Response(null, { status: 303, headers: { Location: "/portal/home", "Cache-Control": "no-store" } });
  for (const c of portalCookies(ordered)) res.headers.append("Set-Cookie", c);
  return res;
}
