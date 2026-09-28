import Link from "next/link";
import { Logo } from "@/components/logo";
import { getVisitorBrand, PLATFORM_NAME } from "@/lib/brand";
import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Forgot password" };
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const brand = await getVisitorBrand();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo brand={brand} fallbackName={PLATFORM_NAME} className="origin-center scale-150" />
          <p className="mt-8 text-sm font-medium uppercase tracking-[0.18em] text-slate-500">Reset your password</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <ForgotForm />
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          <Link href="/login" className="font-medium text-brand-700 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
