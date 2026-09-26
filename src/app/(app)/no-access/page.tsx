import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/permissions";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "No access" };

export default async function NoAccessPage() {
  const user = await requireUser();
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center py-12 text-center sm:py-20">
      <div className="mb-5 rounded-full bg-slate-100 p-4 text-slate-400">
        <Lock className="size-8" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">You don&apos;t have access to this page</h1>
      <p className="mt-3 text-base leading-relaxed text-slate-600">
        What you can see in the Command Center depends on your role. You&apos;re signed in as <span className="font-medium text-slate-800">{ROLE_LABELS[user.role]}</span>, which doesn&apos;t include this page.
      </p>
      <p className="mt-2 text-base leading-relaxed text-slate-600">If you think you need it for your work, ask the owner to change your access.</p>
      <LinkButton href="/dashboard" variant="primary" size="lg" className="mt-8">
        Back to dashboard
      </LinkButton>
    </div>
  );
}
