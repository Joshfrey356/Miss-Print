import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { files, jobs, mentions, messages, users, type Role } from "@/lib/db/schema";
import { getChannel, visibleChannels } from "./channels";
import type { ChatMessage } from "./types";

export type { ChatMessage } from "./types";

const chatSelect = {
  id: messages.id,
  body: messages.body,
  important: messages.important,
  createdAt: messages.createdAt,
  editedAt: messages.editedAt,
  authorId: users.id,
  authorName: users.name,
  authorHandle: users.handle,
  authorColor: users.color,
  fileId: files.id,
  fileName: files.filename,
  fileMime: files.mimeType,
};

type ChatRow = {
  id: number;
  body: string;
  important: boolean;
  createdAt: Date;
  editedAt: Date | null;
  authorId: number;
  authorName: string;
  authorHandle: string;
  authorColor: string;
  fileId: number | null;
  fileName: string | null;
  fileMime: string | null;
};

const toChat = (r: ChatRow): ChatMessage => ({
  id: r.id,
  body: r.body,
  important: r.important,
  createdAt: r.createdAt,
  editedAt: r.editedAt,
  author: { id: r.authorId, name: r.authorName, handle: r.authorHandle, color: r.authorColor },
  file: r.fileId ? { id: r.fileId, filename: r.fileName!, mimeType: r.fileMime! } : null,
});

async function loadMessages(tenantId: number, where: ReturnType<typeof and>, limit: number) {
  const rows = await db
    .select(chatSelect)
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .leftJoin(files, and(eq(files.id, messages.fileId), isNull(files.archivedAt)))
    .where(and(eq(messages.tenantId, tenantId), where))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit);
  return rows.reverse().map(toChat);
}

/** A job's chat, oldest first (the latest 300 messages). */
export function getJobMessages(tenantId: number, jobId: number): Promise<ChatMessage[]> {
  return loadMessages(tenantId, and(eq(messages.jobId, jobId), isNull(messages.archivedAt)), 300);
}

/** A department channel in one shop, oldest first (the latest 200 messages). */
export function getChannelMessages(tenantId: number, channel: string): Promise<ChatMessage[]> {
  return loadMessages(tenantId, and(eq(messages.channel, channel), isNull(messages.jobId), isNull(messages.archivedAt)), 200);
}

export type MentionItem = ChatMessage & {
  source: { kind: "job"; number: number; title: string } | { kind: "channel"; key: string; label: string };
  href: string;
};

/** Messages that mention this user, newest first, across jobs and channels. */
export async function getMentionsFor(tenantId: number, userId: number, role: Role, limit = 50): Promise<MentionItem[]> {
  const rows = await db
    .select({ ...chatSelect, channel: messages.channel, jobNumber: jobs.number, jobTitle: jobs.title })
    .from(mentions)
    .innerJoin(messages, eq(messages.id, mentions.messageId))
    .innerJoin(users, eq(users.id, messages.authorId))
    .leftJoin(files, and(eq(files.id, messages.fileId), isNull(files.archivedAt)))
    .leftJoin(jobs, eq(jobs.id, messages.jobId))
    .where(and(eq(messages.tenantId, tenantId), eq(mentions.userId, userId), isNull(messages.archivedAt)))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  const allowed = new Set(visibleChannels(role).map((c) => c.key));
  return rows
    .filter((r) => r.jobNumber != null || (r.channel && allowed.has(r.channel)))
    .map((r) => {
      const base = toChat(r);
      if (r.jobNumber != null)
        return { ...base, source: { kind: "job" as const, number: r.jobNumber, title: r.jobTitle ?? "" }, href: `/jobs/${r.jobNumber}?tab=chat` };
      const ch = getChannel(r.channel)!;
      return { ...base, source: { kind: "channel" as const, key: ch.key, label: ch.label }, href: `/messages?channel=${ch.key}` };
    });
}

export type JobConversation = {
  jobId: number;
  jobNumber: number;
  jobTitle: string;
  lastBody: string;
  lastAt: Date;
  lastAuthor: string;
  important: boolean;
  count: number;
};

/** Latest message per job over the last `days` days, newest first. */
export async function getRecentJobConversations(tenantId: number, days = 14, limit = 30): Promise<JobConversation[]> {
  const since = new Date(Date.now() - days * 86400000);
  const latest = await db
    .selectDistinctOn([messages.jobId], {
      jobId: messages.jobId,
      jobNumber: jobs.number,
      jobTitle: jobs.title,
      lastBody: messages.body,
      lastAt: messages.createdAt,
      lastAuthor: users.name,
      important: messages.important,
    })
    .from(messages)
    .innerJoin(jobs, eq(jobs.id, messages.jobId))
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(
      and(
        eq(messages.tenantId, tenantId),
        isNotNull(messages.jobId),
        isNull(messages.archivedAt),
        isNull(jobs.archivedAt),
        gt(messages.createdAt, since),
      ),
    )
    .orderBy(messages.jobId, desc(messages.createdAt));
  const top = latest.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime()).slice(0, limit);
  if (!top.length) return [];
  const counts = await db
    .select({ jobId: messages.jobId, n: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, tenantId),
        inArray(messages.jobId, top.map((t) => t.jobId!)),
        isNull(messages.archivedAt),
        gt(messages.createdAt, since),
      ),
    )
    .groupBy(messages.jobId);
  const byJob = new Map(counts.map((c) => [c.jobId, c.n]));
  return top.map((t) => ({ ...t, jobId: t.jobId!, count: byJob.get(t.jobId) ?? 1 }));
}

export type ChannelSummary = { key: string; lastBody: string | null; lastAt: Date | null; lastAuthor: string | null };

/** Latest message in each channel the role can see, in one shop. */
export async function getChannelSummaries(tenantId: number, role: Role): Promise<Record<string, ChannelSummary>> {
  const keys = visibleChannels(role).map((c) => c.key);
  const rows = await db
    .selectDistinctOn([messages.channel], { key: messages.channel, lastBody: messages.body, lastAt: messages.createdAt, lastAuthor: users.name })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(and(eq(messages.tenantId, tenantId), inArray(messages.channel, keys), isNull(messages.jobId), isNull(messages.archivedAt)))
    .orderBy(messages.channel, desc(messages.createdAt));
  const out: Record<string, ChannelSummary> = {};
  for (const k of keys) out[k] = { key: k, lastBody: null, lastAt: null, lastAuthor: null };
  for (const r of rows) if (r.key) out[r.key] = { key: r.key, lastBody: r.lastBody, lastAt: r.lastAt, lastAuthor: r.lastAuthor };
  return out;
}

/** Is this file attached to a channel message the role may see? (for /messages/file/[id]) */
export async function channelFileVisible(tenantId: number, fileId: number, role: Role) {
  const rows = await db
    .select({ channel: messages.channel })
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), eq(messages.fileId, fileId), isNull(messages.archivedAt), isNull(messages.jobId)));
  const allowed = new Set(visibleChannels(role).map((c) => c.key));
  return rows.some((r) => r.channel && allowed.has(r.channel));
}
