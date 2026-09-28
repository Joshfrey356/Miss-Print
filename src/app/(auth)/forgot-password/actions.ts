"use server";
import { z } from "zod";
import { clientIp } from "@/lib/auth";
import { requestPasswordReset } from "@/lib/auth/account-links";

export async function forgotPasswordAction(_prev: { error?: string; sent?: boolean } | undefined, formData: FormData) {
  const email = z.email().max(200).safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!email.success) return { error: "Enter the email you sign in with." };
  try {
    await requestPasswordReset(email.data, await clientIp());
  } catch (e) {
    console.error("[forgot-password] failed", e);
  }
  // Same answer either way, so this page can't be used to find out who has an account.
  return { sent: true };
}
