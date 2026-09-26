import { NextResponse } from "next/server";
import { getTenant, tenantLogoUrl } from "@/lib/tenant";

/** Browser-tab icon for a shop: its logo, or its initials when it has none. Public, like the logo. */
export async function GET(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  const id = Number(tenantId);
  const tenant = Number.isInteger(id) && id > 0 ? await getTenant(id) : undefined;
  if (!tenant || tenant.archivedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const logo = tenantLogoUrl(tenant);
  if (logo) return NextResponse.redirect(new URL(logo, req.url));
  const initials =
    tenant.name
      .split(/\s+/)
      .filter((w) => /^[a-z0-9]/i.test(w))
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1a8fe3"/><text x="32" y="43" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="28" text-anchor="middle" fill="#fff">${initials}</text></svg>`;
  return new NextResponse(svg, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}
