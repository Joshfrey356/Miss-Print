import { Logo } from "@/components/logo";
import type { Brand } from "@/lib/brand";
import { getSettings } from "@/lib/settings";

/** The shop turned its customer portal off (Settings → Customer Portal). */
export async function PortalOff({ brand }: { brand: Brand | null }) {
  const company = brand ? (await getSettings(brand.tenantId)).company : null;
  return (
    <main className="flex min-h-dvh items-start justify-center bg-slate-50 px-4 py-12 sm:items-center">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo brand={brand} fallbackName="Customer portal" className="origin-center scale-125" />
          <p className="mt-6 text-sm font-medium uppercase tracking-[0.18em] text-slate-500">Customer portal</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-lg font-semibold text-slate-900">The customer portal isn&apos;t available.</p>
          <p className="mt-2 text-[15px] text-slate-600">
            {company && (company.phone || company.email) ? (
              <>
                Please contact {company.name || "us"}
                {company.phone && (
                  <>
                    {" "}at{" "}
                    <a href={`tel:${company.phone.replace(/[^\d+]/g, "")}`} className="font-medium text-brand-700 hover:underline">
                      {company.phone}
                    </a>
                  </>
                )}
                {company.email && (
                  <>
                    {company.phone ? " or " : " at "}
                    <a href={`mailto:${company.email}`} className="font-medium text-brand-700 hover:underline">
                      {company.email}
                    </a>
                  </>
                )}
                .
              </>
            ) : (
              "Please contact the shop directly."
            )}
          </p>
        </div>
      </div>
    </main>
  );
}
