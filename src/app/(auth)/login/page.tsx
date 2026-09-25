import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { next } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="scale-150" />
          <p className="mt-8 text-sm font-medium uppercase tracking-[0.18em] text-slate-500">Command Center</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm next={next} demo={process.env.NODE_ENV !== "production" || process.env.SHOW_DEMO_LOGINS === "1"} />
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">Miss Print · Munster & Hammond, Indiana · Since 1986</p>
      </div>
    </main>
  );
}
