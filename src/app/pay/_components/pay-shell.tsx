import { Logo } from "@/components/logo";
import type { Brand } from "@/lib/brand";
import type { CompanyProfile } from "@/lib/settings";

/** Frame for the public, customer-facing payment pages, branded for the shop. */
export function PayShell({ brand, company, children }: { brand: Brand | null; company: CompanyProfile | null; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-4 px-4 py-4">
          <Logo brand={brand} fallbackName="Payment" />
          {company && (company.phone || company.email) && (
            <div className="text-right text-sm text-slate-500">
              {company.phone && <p>{company.phone}</p>}
              {company.email && <p>{company.email}</p>}
            </div>
          )}
        </div>
      </header>
      <div className="mx-auto max-w-xl px-4 py-10">{children}</div>
    </main>
  );
}

export function PayCard({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto flex size-14 items-center justify-center">{icon}</div>
      <h1 className="mt-3 text-2xl font-semibold text-slate-900">{title}</h1>
      {children && <div className="mt-3 space-y-2 text-[15px] text-slate-600">{children}</div>}
    </div>
  );
}
