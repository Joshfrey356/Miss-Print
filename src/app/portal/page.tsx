import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getVisitorBrand } from "@/lib/brand";
import { getPortalSession } from "@/lib/portal/session";
import { PortalSignInForm } from "@/components/portal/sign-in-form";
import { PortalOff } from "@/components/portal/portal-off";
import { getPortalSettings } from "@/lib/portal/settings";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ shop?: string }> }): Promise<Metadata> {
  const brand = await getVisitorBrand((await searchParams).shop ?? null);
  return { title: { absolute: brand?.name ? `Customer portal · ${brand.name}` : "Customer portal" }, robots: { index: false, follow: false } };
}

/** Customer portal sign-in: no passwords — we email a one-time sign-in link. */
export default async function PortalSignInPage({ searchParams }: { searchParams: Promise<{ shop?: string; signedOut?: string; expired?: string }> }) {
  const sp = await searchParams;
  if (await getPortalSession()) redirect("/portal/home");
  const brand = await getVisitorBrand(sp.shop ?? null);
  if (brand && !(await getPortalSettings(brand.tenantId)).enabled) return <PortalOff brand={brand} />;
  return (
    <main className="flex min-h-dvh items-start justify-center bg-slate-50 px-4 py-12 sm:items-center">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo brand={brand} fallbackName="Customer portal" className="origin-center scale-125" />
          <p className="mt-6 text-sm font-medium uppercase tracking-[0.18em] text-slate-500">Customer portal</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {sp.signedOut && <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">You&apos;re signed out.</p>}
          {sp.expired && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">That sign-in link has expired. Enter your email to get a new one.</p>}
          <PortalSignInForm />
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">Check on orders, approve proofs, accept quotes, pay invoices and reorder — any time.</p>
      </div>
    </main>
  );
}
