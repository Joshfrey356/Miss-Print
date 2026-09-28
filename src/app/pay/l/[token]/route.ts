import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { paymentLinks, tenants } from "@/lib/db/schema";
import { readPayToken } from "@/lib/payments/tokens";

export const dynamic = "force-dynamic";

/** Short link in the counter's QR code → the Stripe payment page (or "already paid"). */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = readPayToken(token, "link");
  const done = (q: string, slug = "") => NextResponse.redirect(new URL(`/pay/done?shop=${encodeURIComponent(slug)}&${q}`, req.url), 303);
  if (!t) return done("invalid=1");
  const [row] = await db
    .select({ link: paymentLinks, slug: tenants.slug })
    .from(paymentLinks)
    .innerJoin(tenants, eq(tenants.id, paymentLinks.tenantId))
    .where(and(eq(paymentLinks.tenantId, t.tenantId), eq(paymentLinks.id, t.id)));
  if (!row) return done("invalid=1");
  if (row.link.status === "paid") return done(`session_id=${encodeURIComponent(row.link.providerRef)}`, row.slug);
  if (row.link.status !== "open" || !row.link.url) return done("expired=1", row.slug);
  return NextResponse.redirect(row.link.url, 303);
}
