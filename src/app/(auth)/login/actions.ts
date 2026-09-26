"use server";
import { redirect } from "next/navigation";
import { previewSignIn, signIn, signOut } from "@/lib/auth";

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const result = await signIn(email, password);
  if (!result.ok) return { error: result.error };
  const next = String(formData.get("next") ?? "");
  // Only allow internal redirects.
  // Reject "//host" and "/\host" (browsers treat a backslash like a slash).
  redirect(next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/dashboard");
}

export async function logoutAction() {
  await signOut();
  redirect("/login");
}

/** Preview mode: one-click demo sign-in (refused unless running on the built-in demo data). */
export async function previewLoginAction(formData: FormData) {
  const r = await previewSignIn(String(formData.get("email") ?? ""));
  if (!r.ok) redirect("/login");
  redirect("/dashboard");
}
