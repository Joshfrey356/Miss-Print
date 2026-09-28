import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/setup", "/signup", "/account/", "/forgot-password", "/brand/", "/proof/", "/api/proof/", "/_next", "/favicon", "/logo", "/icon"];

/**
 * Optimistic auth check only (is there a session cookie?).
 * Real authorization happens on the server in every page/action (requireUser / requirePermission).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();
  const token = request.cookies.get("mp_session")?.value;
  if (!token) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
