"use server";
import { revalidatePath } from "next/cache";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { hashPassword, requirePermission } from "@/lib/auth";
import { runAction, str, UserError, type ActionResult } from "@/lib/actions";
import { db } from "@/lib/db";
import { roleEnum, sessions, users } from "@/lib/db/schema";
import { diff, logActivity } from "@/lib/activity";
import { ROLE_LABELS } from "@/lib/permissions";

type Prev = ActionResult | null;

const COLORS = ["#1a8fe3", "#0d9488", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#ca8a04", "#4f46e5", "#dc2626", "#0891b2"];

const baseSchema = z.object({
  name: z.string().min(2, "Enter the person's name.").max(80),
  handle: z
    .string()
    .min(2, "Enter a short name for @mentions.")
    .max(30, "The @mention name is too long.")
    .regex(/^[a-z][a-z0-9._-]+$/, "The @mention name can only use lowercase letters, numbers, dots and dashes, and must start with a letter."),
  email: z.email("Enter a valid email address.").max(160),
  role: z.enum(roleEnum.enumValues, { error: "Choose a role." }),
  title: z.string().max(80).nullable(),
  phone: z.string().max(40).nullable(),
  locationId: z.coerce.number().int().positive().nullable(),
});

function readUser(fd: FormData) {
  return baseSchema.parse({
    name: str(fd, "name") ?? "",
    handle: (str(fd, "handle") ?? "").replace(/^@/, "").toLowerCase(),
    email: (str(fd, "email") ?? "").toLowerCase(),
    role: str(fd, "role") ?? "",
    title: str(fd, "title"),
    phone: str(fd, "phone"),
    locationId: str(fd, "locationId"),
  });
}

async function assertUnique(email: string, handle: string, exceptId?: number) {
  const notMe = exceptId ? ne(users.id, exceptId) : undefined;
  const [e] = await db.select({ n: count() }).from(users).where(and(sql`lower(${users.email}) = ${email}`, notMe));
  if (e!.n > 0) throw new UserError("Someone already uses that email address.");
  const [h] = await db.select({ n: count() }).from(users).where(and(eq(users.handle, handle), notMe));
  if (h!.n > 0) throw new UserError(`@${handle} is already taken. Try another @mention name.`);
}

function readPassword(fd: FormData) {
  const pw = String(fd.get("password") ?? "");
  if (pw.length < 10) throw new UserError("The password must be at least 10 characters.");
  if (pw.length > 200) throw new UserError("That password is too long.");
  return pw;
}

export async function createUser(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requirePermission("users.manage");
    const data = readUser(fd);
    const password = readPassword(fd);
    await assertUnique(data.email, data.handle);
    const [{ n }] = await db.select({ n: count() }).from(users);
    const passwordHash = await hashPassword(password);
    await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({ ...data, passwordHash, color: COLORS[n % COLORS.length]! })
        .returning({ id: users.id });
      await logActivity(
        {
          action: "user.created",
          entityType: "user",
          entityId: u!.id,
          actorId: me.id,
          summary: `Added ${data.name} as ${ROLE_LABELS[data.role]}`,
          data: { after: { ...data } },
        },
        tx,
      );
    });
    revalidatePath("/settings/team");
  }, "Team member added");
}

export async function updateUser(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requirePermission("users.manage");
    const id = Number(fd.get("id"));
    const data = readUser(fd);
    const [before] = await db.select().from(users).where(eq(users.id, id));
    if (!before) throw new UserError("That person no longer exists.");
    if (id === me.id && data.role !== before.role) throw new UserError("You can't change your own role. Ask another owner to do it.");
    await assertUnique(data.email, data.handle, id);
    const changes = diff(before, data);
    if (!changes) return;
    await db.transaction(async (tx) => {
      await tx.update(users).set(data).where(eq(users.id, id));
      await logActivity({ action: "user.updated", entityType: "user", entityId: id, actorId: me.id, summary: `Updated ${data.name}`, data: changes }, tx);
    });
    revalidatePath("/settings/team");
  }, "Saved");
}

export async function resetUserPassword(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requirePermission("users.manage");
    const id = Number(fd.get("id"));
    const password = readPassword(fd);
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, id));
    if (!u) throw new UserError("That person no longer exists.");
    const passwordHash = await hashPassword(password);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, id));
      if (id !== me.id) await tx.delete(sessions).where(eq(sessions.userId, id));
      await logActivity({ action: "user.password_reset", entityType: "user", entityId: id, actorId: me.id, summary: `Reset the password for ${u.name}` }, tx);
    });
  }, "Password reset. Give them the new password; they'll need to sign in again.");
}

export async function setUserActive(id: number, active: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requirePermission("users.manage");
    if (id === me.id && !active) throw new UserError("You can't deactivate yourself.");
    const [u] = await db.select({ name: users.name, active: users.active }).from(users).where(eq(users.id, id));
    if (!u) throw new UserError("That person no longer exists.");
    if (u.active === active) return;
    await db.transaction(async (tx) => {
      await tx.update(users).set({ active }).where(eq(users.id, id));
      if (!active) await tx.delete(sessions).where(eq(sessions.userId, id));
      await logActivity(
        {
          action: active ? "user.reactivated" : "user.deactivated",
          entityType: "user",
          entityId: id,
          actorId: me.id,
          summary: `${active ? "Reactivated" : "Deactivated"} ${u.name}`,
          data: { before: { active: u.active }, after: { active } },
        },
        tx,
      );
    });
    revalidatePath("/settings/team");
  }, active ? "Reactivated — they can sign in again" : "Deactivated — they've been signed out");
}
