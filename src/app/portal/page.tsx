import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getVisitorBrand } from "@/lib/brand";
import { getPortalSession } from "@/lib/portal/session";
import { PortalSignInForm } from "@/components/portal/sign-in-form";
import { PortalOff } from "@/components/portal/portal-off";
import { getPortalSettings } from "@/lib/portal/settings";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ shop?: string }> }): Promise<Metadata> {
  const brand = await getVisitorBrand((await searchParams).shop ?? null);
  return { title: { absolute: brand?.name ? `Customer portal · ${brand.name}` : "Customer portal" }, robots: { index: false, follow: false } };
}

/** Customer portal sign-in: no passwords — we email a one-time sign-in link. */
export default async function PortalSignInPage({ searchParams }: { searchParams: Promise<{ shop?: string; signedOut?: string; expired?: string }> }) {
  const sp = await searchParams;
  if (await getPortalSession()) redirect("/portal/home");
  const [brand, staff] = await Promise.all([getVisitorBrand(sp.shop ?? null), getCurrentUser()]);
  if (brand && !(await getPortalSettings(brand.tenantId)).enabled && !staff) return <PortalOff brand={brand} />;
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
          {staff && (
            // Staff emails aren't customer emails, so signing in here sends nothing. Point them at the preview.
            <div className="mb-5 rounded-lg bg-brand-50 px-3 py-3 text-sm text-brand-900">
              <p className="font-semibold">You&apos;re signed in as staff ({staff.name}).</p>
              <p className="mt-1">
                This page is for your customers — they sign in with the email on their customer record. To see the portal the way a customer does, open a customer and press <strong>Preview portal</strong>.
              </p>
              <a href="/customers" className="mt-2 inline-block font-medium text-brand-700 hover:underline">
                Go to Customers →
              </a>
            </div>
          )}
          <PortalSignInForm />
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">Check on orders, approve proofs, accept quotes, pay invoices and reorder — any time.</p>
      </div>
    </main>
  );
}
