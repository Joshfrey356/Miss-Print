import Link from "next/link";
import { Logo } from "@/components/logo";
import { readAccountLink } from "@/lib/auth/account-links";
import { getBrand, PLATFORM_NAME } from "@/lib/brand";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Set your password" };
export const dynamic = "force-dynamic";

/** Landing page for invite and password-reset emails, branded for the person's shop. */
export default async function AccountLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await readAccountLink(token);
  const brand = link ? await getBrand(link.tenantId) : null;
  const invite = link?.purpose === "invite" && !link.lastLoginAt;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo brand={brand} fallbackName={PLATFORM_NAME} className="origin-center scale-150" />
          <p className="mt-8 text-sm font-medium uppercase tracking-[0.18em] text-slate-500">Command Center</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {link ? (
            <>
              <p className="text-base font-semibold text-slate-900">{invite ? `Welcome, ${link.name.split(" ")[0]}!` : "Choose a new password"}</p>
              <p className="mt-1 mb-5 text-sm text-slate-600">
                {invite ? `You've been added to ${brand?.name ?? "the team"}. ` : ""}You&apos;ll sign in with <strong className="font-medium text-slate-800">{link.email}</strong>.
              </p>
              <PasswordForm token={token} email={link.email} invite={invite} />
            </>
          ) : (
            <>
              <p className="text-base font-semibold text-slate-900">This link has expired</p>
              <p className="mt-1 text-sm text-slate-600">
                It may have been used already, or it&apos;s too old. Ask your manager to send a new invite, or reset your password from the sign-in page.
              </p>
              <Link href="/forgot-password" className="mt-4 inline-block font-medium text-brand-700 hover:underline">
                Reset my password
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
