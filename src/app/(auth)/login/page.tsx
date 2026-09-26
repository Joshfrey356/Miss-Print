import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";
import { isPreviewMode } from "@/lib/db";
import { previewLoginAction } from "./actions";

const PREVIEW_USERS = [
  { email: "owner@missprintusa.com", label: "Owner / Admin", who: "Rick — everything, incl. money & settings" },
  { email: "jen@missprintusa.com", label: "Manager", who: "Jobs, customers, schedule" },
  { email: "alex@missprintusa.com", label: "Front Counter / Sales", who: "Customers, quotes, orders" },
  { email: "sarah@missprintusa.com", label: "Designer", who: "Design queue & proofs" },
  { email: "mike@missprintusa.com", label: "Production", who: "What to print next — no prices" },
  { email: "tony@missprintusa.com", label: "Installer", who: "Installs — no prices" },
  { email: "dana@missprintusa.com", label: "Accounting", who: "Invoices, payments, reports" },
];

export const metadata = { title: "Sign in" };

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { next, error } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="scale-150" />
          <p className="mt-8 text-sm font-medium uppercase tracking-[0.18em] text-slate-500">Command Center</p>
        </div>
        {isPreviewMode() ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-base font-semibold text-slate-900">Preview mode</p>
            <p className="mt-1 text-sm text-slate-600">
              This preview runs on made-up demo data — nothing here is real, and changes may be reset. Pick a role to look around as that person:
            </p>
            {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error.slice(0, 200)}</p>}
            <div className="mt-4 space-y-2">
              {PREVIEW_USERS.map((u) => (
                <form key={u.email} action={previewLoginAction}>
                  <input type="hidden" name="email" value={u.email} />
                  <button className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left hover:border-brand-400 hover:bg-brand-50">
                    <span>
                      <span className="block font-semibold text-slate-900">Enter as {u.label}</span>
                      <span className="block text-sm text-slate-500">{u.who}</span>
                    </span>
                    <span className="text-brand-600">→</span>
                  </button>
                </form>
              ))}
            </div>
            <p className="mt-4 text-xs text-slate-400">Preview turns off automatically once a real database (DATABASE_URL) is connected.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <LoginForm next={next} demo={process.env.NODE_ENV !== "production" || process.env.SHOW_DEMO_LOGINS === "1"} />
          </div>
        )}
        <p className="mt-6 text-center text-xs text-slate-400">Miss Print · Munster & Hammond, Indiana · Since 1986</p>
      </div>
    </main>
  );
}
