"use server";
import { refresh } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { runAction, type ActionResult } from "@/lib/actions";

export async function markNotificationRead(id: number): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.tenantId, user.tenantId),
          eq(notifications.id, id),
          eq(notifications.userId, user.id),
          isNull(notifications.readAt),
        ),
      );
    refresh();
  });
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.tenantId, user.tenantId), eq(notifications.userId, user.id), isNull(notifications.readAt)));
    refresh();
  });
}
