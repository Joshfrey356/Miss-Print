import type { Metadata } from "next";
import Link from "next/link";
import { Clock } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { getBrand } from "@/lib/brand";
import { getPortalAccounts } from "@/lib/portal/session";
import { readPortalLink } from "@/lib/portal/links";
import { safePortalNext } from "@/lib/portal/tokens";
import { PortalSignInForm } from "@/components/portal/sign-in-form";
import { PortalOff } from "@/components/portal/portal-off";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "Sign in · Customer portal" }, robots: { index: false, follow: false } };

/**
 * Landing page of an emailed sign-in link. Opening it doesn't sign in (email scanners open links);
 * the button does, with a POST to /api/portal/login.
 */
export default async function PortalLoginPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ next?: string }> }) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const next = safePortalNext(sp.next);
  const link = await readPortalLink(token);
  const brand = link.tenantId ? await getBrand(link.tenantId) : null;
  // Already signed in to this customer in this browser (e.g. the link was clicked twice): just continue.
  const accounts = link.tenantId ? await getPortalAccounts() : [];
  const signedIn = accounts.find((a) => a.tenantId === link.tenantId && a.customerId === link.customerId);
  if (link.state === "off") return <PortalOff brand={brand} />;

  return (
    <main className="flex min-h-dvh items-start justify-center bg-slate-50 px-4 py-12 sm:items-center">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo brand={brand} fallbackName="Customer portal" className="origin-center scale-125" />
          <p className="mt-6 text-sm font-medium uppercase tracking-[0.18em] text-slate-500">Customer portal</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {link.state === "ok" ? (
            <form action="/api/portal/login" method="post" className="space-y-4 text-center">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="next" value={next} />
              <p className="text-lg font-semibold text-slate-900">Welcome{link.contactName ? `, ${link.contactName.split(" ")[0]}` : ""}!</p>
              <p className="text-[15px] text-slate-600">
                Sign in to see orders, proofs, quotes and invoices for <strong className="font-semibold text-slate-800">{link.customerName}</strong>.
              </p>
              <Button type="submit" variant="primary" size="lg" className="w-full">
                Sign in
              </Button>
              <p className="text-xs text-slate-500">You&apos;ll stay signed in on this device.</p>
            </form>
          ) : signedIn ? (
            <div className="space-y-4 text-center">
              <p className="text-lg font-semibold text-slate-900">You&apos;re already signed in.</p>
              <Link href={next} className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-brand-500 px-5 text-base font-medium text-white shadow-sm hover:bg-brand-600">
                Continue
              </Link>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="text-center">
                <Clock className="mx-auto size-9 text-slate-400" />
                <p className="mt-2 text-lg font-semibold text-slate-900">
                  {link.state === "used" ? "This sign-in link was already used." : link.state === "expired" ? "This sign-in link has expired." : "This sign-in link isn't valid."}
                </p>
                <p className="mt-1 text-[15px] text-slate-600">Enter your email and we&apos;ll send you a new one.</p>
              </div>
              <PortalSignInForm email={link.state === "revoked" ? null : link.email} />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
