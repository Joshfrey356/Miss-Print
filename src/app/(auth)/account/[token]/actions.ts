"use server";
import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { redeemAccountLink } from "@/lib/auth/account-links";

/** Choose a password from an invite or reset link, then sign straight in. */
export async function setPasswordAction(_prev: { error?: string } | undefined, formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password.length < 10) return { error: "Use at least 10 characters for the password." };
  if (password.length > 200) return { error: "That password is too long." };
  if (password !== String(formData.get("confirm") ?? "")) return { error: "The two passwords don't match." };
  const email = await redeemAccountLink(token, password);
  if (!email) return { error: "This link has expired or was already used. Ask your manager to send a new one, or use “Forgot password?” on the sign-in page." };
  const r = await signIn(email, password);
  redirect(r.ok ? "/dashboard" : "/login");
}
