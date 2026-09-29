import Link from "next/link";
import { ChevronDown, LogOut, Mail, Phone } from "lucide-react";
import { Logo } from "@/components/logo";
import type { Brand } from "@/lib/brand";
import type { CompanyProfile } from "@/lib/settings";
import type { PortalSession } from "@/lib/portal/session";
import { PortalNav } from "./portal-nav";

/**
 * Frame for the signed-in customer portal, white-labelled for the shop: its logo and name, the
 * customer's account (with a switcher when this browser is signed in to several), and a simple nav.
 */
export function PortalShell({
  brand,
  company,
  session,
  accounts,
  counts,
  askHref,
  children,
}: {
  brand: Brand;
  company: CompanyProfile;
  session: PortalSession;
  accounts: { key: string; label: string }[];
  counts: { quotes: number; invoices: number; proofs: number };
  /** Where "Ask us" goes (quote request or message), or null when both are turned off. */
  askHref: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-slate-50 print:bg-white">
      {session.previewBy && (
        <div className="bg-amber-100 text-amber-950 print:hidden">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 text-sm">
            <p>
              <strong className="font-semibold">Preview</strong> — this is what {session.customerName} sees. Buttons like Accept, Pay and Upload are turned off for you.
            </p>
            <span className="flex items-center gap-2">
              <a href={`/customers/${session.customerId}`} className="rounded-md px-2 py-1 font-medium underline-offset-2 hover:underline">
                Back to the app
              </a>
              <form action="/api/portal/logout" method="post">
                <button className="rounded-md bg-amber-950 px-3 py-1 font-medium text-white hover:bg-amber-900">End preview</button>
              </form>
            </span>
          </div>
        </div>
      )}
      <header className="border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/portal/home" className="min-w-0 shrink" aria-label={`${brand.name} — home`}>
            <Logo brand={brand} compact className="max-w-[55vw] sm:max-w-none" />
          </Link>
          <details className="group relative">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-right hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">
                <span className="block max-w-[38vw] truncate text-sm font-semibold text-slate-900 sm:max-w-xs">{session.customerName}</span>
                <span className="block max-w-[38vw] truncate text-xs text-slate-500 sm:max-w-xs">{session.previewBy ? `Preview by ${session.previewBy.name}` : session.email}</span>
              </span>
              <ChevronDown className="size-4 shrink-0 text-slate-400 group-open:rotate-180" />
            </summary>
            <div className="absolute right-0 z-40 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
              {accounts.length > 0 && (
                <>
                  <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Switch account</p>
                  {accounts.map((a) => (
                    <form key={a.key} action="/api/portal/switch" method="post">
                      <input type="hidden" name="to" value={a.key} />
                      <button className="w-full rounded-lg px-3 py-2 text-left text-[15px] text-slate-800 hover:bg-slate-50">{a.label}</button>
                    </form>
                  ))}
                  <div className="my-1 h-px bg-slate-100" />
                </>
              )}
              <form action="/api/portal/logout" method="post">
                <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[15px] text-slate-800 hover:bg-slate-50">
                  <LogOut className="size-4 text-slate-400" /> Sign out
                </button>
              </form>
              {accounts.length > 0 && (
                <form action="/api/portal/logout" method="post">
                  <input type="hidden" name="all" value="1" />
                  <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50">Sign out of all accounts</button>
                </form>
              )}
            </div>
          </details>
        </div>
        <PortalNav counts={counts} askHref={askHref} />
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:py-8 print:max-w-none print:p-0">{children}</main>
      <footer className="mx-auto max-w-5xl px-4 pb-10 text-sm text-slate-500 print:hidden">
        <div className="flex flex-col gap-1 border-t border-slate-200 pt-4 sm:flex-row sm:flex-wrap sm:gap-x-5">
          <span className="font-medium text-slate-700">{company.name}</span>
          {company.phone && (
            <a href={`tel:${company.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1.5 hover:text-slate-800">
              <Phone className="size-3.5" /> {company.phone}
            </a>
          )}
          {company.email && (
            <a href={`mailto:${company.email}`} className="inline-flex items-center gap-1.5 hover:text-slate-800">
              <Mail className="size-3.5" /> {company.email}
            </a>
          )}
          {company.hours && <span>{company.hours}</span>}
        </div>
      </footer>
    </div>
  );
}
