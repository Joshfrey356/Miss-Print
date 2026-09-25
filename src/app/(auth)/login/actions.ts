"use server";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/auth";

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const result = await signIn(email, password);
  if (!result.ok) return { error: result.error };
  const next = String(formData.get("next") ?? "");
  // Only allow internal redirects.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logoutAction() {
  await signOut();
  redirect("/login");
}
