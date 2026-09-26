"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn } from "@/lib/auth";
import { runFirstTimeSetup, SetupClosedError } from "@/lib/setup";

const schema = z.object({
  shopName: z.string().trim().min(2, "Enter your shop's name.").max(80),
  name: z.string().trim().min(2, "Enter your name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  password: z.string().min(10, "Use at least 10 characters for the password.").max(200),
  confirm: z.string(),
});

export async function setupAction(_prev: { error?: string } | undefined, formData: FormData) {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { shopName, name, email, password, confirm } = parsed.data;
  if (password !== confirm) return { error: "The two passwords don't match." };
  try {
    await runFirstTimeSetup({ shopName, name, email, password });
  } catch (e) {
    if (e instanceof SetupClosedError) redirect("/login");
    console.error("[setup] failed", e);
    return { error: "Setup couldn't finish — the database may be unreachable. Check DATABASE_URL in Vercel and try again." };
  }
  const r = await signIn(email, password);
  redirect(r.ok ? "/settings" : "/login");
}
