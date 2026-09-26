import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getSetupState } from "@/lib/setup";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Set up" };
export const dynamic = "force-dynamic";

/** First-run page: only shown while the real database has no users yet. */
export default async function SetupPage() {
  const { state } = await getSetupState();
  if (state === "preview" || state === "ready") redirect("/login");
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="scale-150" />
          <p className="mt-8 text-sm font-medium uppercase tracking-[0.18em] text-slate-500">Command Center · First-time setup</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {state === "db_error" ? (
            <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Couldn&apos;t reach the database. Check DATABASE_URL in Vercel. You can still try — setup will attempt to create the tables.
            </p>
          ) : (
            <p className="mb-4 text-sm text-slate-600">
              The database is connected and empty. Create the owner account — this also loads the two locations, starter pricing, vendors and materials. This page closes for good once the owner exists.
            </p>
          )}
          <SetupForm />
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">Miss Print · Munster & Hammond, Indiana · Since 1986</p>
      </div>
    </main>
  );
}
