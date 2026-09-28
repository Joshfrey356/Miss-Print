import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { notifications, users } from "@/lib/db/schema";

/** Notification kinds a user can turn on/off in their preferences. */
export const NOTIFICATION_KINDS = {
  mention: "Someone @mentions me",
  assigned: "I'm assigned to a job or task",
  proof: "A customer approves or rejects a proof",
  quote: "A customer accepts a quote",
  artwork: "Artwork is uploaded to my job",
  due_soon: "My jobs are due tomorrow",
  invoice: "An invoice becomes overdue",
  request: "A customer sends a request from the customer portal",
} as const;
export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

type NotifyInput = {
  /** The shop this happened in. Only people in that shop are notified. */
  tenantId: number;
  userIds: (number | null | undefined)[];
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  actorId?: number | null;
};

/** Notify people — skips the actor themself and anyone who turned this kind off. */
export async function notify(input: NotifyInput, tx: Tx | typeof db = db) {
  const ids = [...new Set(input.userIds.filter((id): id is number => typeof id === "number"))].filter(
    (id) => id !== input.actorId,
  );
  if (!ids.length) return;
  const recipients = await tx
    .select({ id: users.id, prefs: users.notificationPrefs, active: users.active })
    .from(users)
    .where(and(eq(users.tenantId, input.tenantId), inArray(users.id, ids)));
  const rows = recipients
    .filter((u) => u.active && u.prefs?.[input.kind] !== false)
    .map((u) => ({
      tenantId: input.tenantId,
      userId: u.id,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      actorId: input.actorId ?? null,
    }));
  if (rows.length) await tx.insert(notifications).values(rows);
}

/** Find @handles in a message body. */
export function parseMentions(body: string): string[] {
  return [...new Set([...body.matchAll(/(^|[^\w@])@([a-z][\w.-]{0,30}[a-z0-9])/gi)].map((m) => m[2]!.toLowerCase()))];
}
