import "server-only";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/settings";
import { getTenant, getTenantBySlug, SHOP_COOKIE, tenantLogoUrl } from "@/lib/tenant";

/** Name of the app itself, used where no shop is known yet (e.g. a first visit to /login). */
export const PLATFORM_NAME = process.env.APP_NAME?.trim() || "Print Shop Command Center";

/** What the UI needs to white-label a page for one shop. Safe to pass to client components. */
export type Brand = { tenantId: number; name: string; tagline: string; logoUrl: string | null; jobPrefix: string };

/** A shop's brand: its name and logo (Settings → Company Profile) plus its tagline. */
export async function getBrand(tenantId: number): Promise<Brand> {
  const [t, { company }] = await Promise.all([getTenant(tenantId), getSettings(tenantId)]);
  return { tenantId, name: company.name, tagline: company.tagline, logoUrl: t ? tenantLogoUrl(t) : null, jobPrefix: t?.jobPrefix ?? "J" };
}

/**
 * Brand for pages shown before sign-in (/login): ?shop=<slug>, else the shop last signed in
 * on this device, else null (the page shows the platform name).
 */
export async function getVisitorBrand(shopParam?: string | null): Promise<Brand | null> {
  const slug = shopParam?.trim() || (await cookies()).get(SHOP_COOKIE)?.value;
  if (!slug || !/^[a-z0-9-]{1,60}$/i.test(slug)) return null;
  try {
    const t = await getTenantBySlug(slug);
    return t && !t.archivedAt ? await getBrand(t.id) : null;
  } catch {
    return null; // e.g. the database isn't set up yet
  }
}
