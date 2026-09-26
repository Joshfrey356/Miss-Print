"use server";
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { z } from "zod";
import { hashPassword, requireUser, SESSION_COOKIE, verifyPassword } from "@/lib/auth";
import { runAction, str, UserError, type ActionResult } from "@/lib/actions";
import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { NOTIFICATION_KINDS } from "@/lib/notifications";

type Prev = ActionResult | null;

export async function saveMyProfile(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const data = z
      .object({ name: z.string().min(2, "Enter your name.").max(80), phone: z.string().max(40).nullable() })
      .parse({ name: str(fd, "name") ?? "", phone: str(fd, "phone") });
    await db.update(users).set(data).where(eq(users.id, user.id));
    revalidatePath("/", "layout");
  }, "Profile saved");
}

export async function changeMyPassword(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const current = String(fd.get("current") ?? "");
    const next = String(fd.get("next") ?? "");
    const confirm = String(fd.get("confirm") ?? "");
    if (!current) throw new UserError("Enter your current password.");
    if (next.length < 10) throw new UserError("Your new password must be at least 10 characters.");
    if (next !== confirm) throw new UserError("The two new passwords don't match.");
    const [row] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, user.id));
    if (!row || !(await verifyPassword(current, row.hash))) throw new UserError("Your current password isn't right.");
    const hash = await hashPassword(next);
    // Keep this browser signed in; sign out everywhere else.
    const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
    const thisSession = createHash("sha256").update(token).digest("hex");
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash: hash }).where(eq(users.id, user.id));
      await tx.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, thisSession)));
      await logActivity({ action: "user.password_changed", entityType: "user", entityId: user.id, actorId: user.id, summary: `${user.name} changed their password` }, tx);
    });
  }, "Password changed. You're still signed in here; other devices were signed out.");
}

export async function saveMyNotifications(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    const prefs = Object.fromEntries(Object.keys(NOTIFICATION_KINDS).map((k) => [k, fd.get(k) === "on"]));
    await db.update(users).set({ notificationPrefs: prefs }).where(eq(users.id, user.id));
    revalidatePath("/settings/profile");
  }, "Notification settings saved");
}
