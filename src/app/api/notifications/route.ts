import { NextResponse } from "next/server";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { forbidden, sameOrigin } from "@/lib/http";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const mine = and(eq(notifications.tenantId, user.tenantId), eq(notifications.userId, user.id));
  const [items, [{ unread }]] = await Promise.all([
    db.select().from(notifications).where(mine).orderBy(desc(notifications.createdAt)).limit(20),
    db.select({ unread: count() }).from(notifications).where(and(mine, isNull(notifications.readAt))),
  ]);
  return NextResponse.json({ unread, items });
}

const Body = z.union([z.object({ all: z.literal(true) }), z.object({ id: z.number().int() })]);

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const which = "all" in parsed.data ? isNull(notifications.readAt) : eq(notifications.id, parsed.data.id);
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.tenantId, user.tenantId), eq(notifications.userId, user.id), which));
  return NextResponse.json({ ok: true });
}
