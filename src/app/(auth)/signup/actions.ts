"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clientIp, signIn } from "@/lib/auth";
import { signUpShop, SignupError } from "@/lib/setup";

const schema = z.object({
  shopName: z.string().trim().min(2, "Enter your shop's name.").max(80, "Shop name is too long."),
  phone: z.string().trim().max(40).optional(),
  name: z.string().trim().min(2, "Enter your name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  password: z.string().min(10, "Use at least 10 characters for the password.").max(200),
  confirm: z.string(),
  code: z.string().optional(),
});

/** A new print shop creates its own account (its own separate data), then lands in Settings. */
export async function signupAction(_prev: { error?: string } | undefined, formData: FormData) {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { password, confirm, ...rest } = parsed.data;
  if (password !== confirm) return { error: "The two passwords don't match." };
  try {
    await signUpShop({ ...rest, password, phone: rest.phone || null }, await clientIp());
  } catch (e) {
    if (e instanceof SignupError) return { error: e.message };
    console.error("[signup] failed", e);
    return { error: "Sign-up couldn't finish. Please try again." };
  }
  const r = await signIn(rest.email, password);
  redirect(r.ok ? "/settings/company?welcome=1" : "/login");
}
