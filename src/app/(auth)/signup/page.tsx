import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getCurrentUser } from "@/lib/auth";
import { PLATFORM_NAME } from "@/lib/brand";
import { getSetupState, signupMode } from "@/lib/setup";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Create your shop" };
export const dynamic = "force-dynamic";

/** Self-service sign-up for a new print shop. Each shop gets its own, separate data. */
export default async function SignupPage() {
  const mode = signupMode();
  if (mode === "off") redirect("/login");
  if ((await getSetupState()).state === "needs_setup") redirect("/setup");
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo brand={null} fallbackName={PLATFORM_NAME} className="scale-150" />
          <p className="mt-8 text-sm font-medium uppercase tracking-[0.18em] text-slate-500">Create your shop</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="mb-4 text-sm text-slate-600">
            Your shop gets its own private workspace: jobs, quotes, customers and money that only your team can see. You&apos;ll start with a starter price list and can add your logo, locations and people in Settings.
          </p>
          <SignupForm needsCode={mode === "code"} />
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
