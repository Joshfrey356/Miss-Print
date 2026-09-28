"use server";
import { refresh } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, mentions, messages, users } from "@/lib/db/schema";
import { ForbiddenError, requirePermission } from "@/lib/auth";
import { bool, int, runAction, str, UserError, type ActionResult } from "@/lib/actions";
import { can } from "@/lib/permissions";
import { saveUpload } from "@/lib/files";
import { notify, parseMentions } from "@/lib/notifications";
import { logActivity } from "@/lib/activity";
import { jobNo } from "@/lib/format";
import { getJobPrefix } from "@/lib/tenant";
import { canSeeChannel, cleanHandle, getChannel, MENTION_GROUPS } from "./channels";

const MAX_BODY = 5000;

/**
 * Post a message to a job chat (jobId) or a department channel (channel).
 * FormData: jobId | channel, body, important ("on"), file (optional attachment).
 * @mentions notify people; @production/@design/@installers/@front/@managers notify a whole team.
 */
export async function postMessage(formData: FormData): Promise<ActionResult<{ id: number }>> {
  return runAction(async () => {
    const user = await requirePermission("messages.use");
    const jobId = int(formData, "jobId");
    const channelKey = str(formData, "channel");
    const rawBody = formData.get("body");
    const body = typeof rawBody === "string" ? rawBody.replace(/\r\n/g, "\n").trim() : "";
    const important = bool(formData, "important");
    const f = formData.get("file");
    const file = f && typeof f === "object" && "arrayBuffer" in f && f.size > 0 ? (f as File) : null;

    if (!body && !file) throw new UserError("Type a message first.");
    if (body.length > MAX_BODY) throw new UserError("That message is too long (5,000 characters max).");

    // Where is this message going?
    let job: { id: number; number: number; title: string; customerId: number } | undefined;
    let channel: ReturnType<typeof getChannel> = null;
    if (jobId) {
      [job] = await db
        .select({ id: jobs.id, number: jobs.number, title: jobs.title, customerId: jobs.customerId })
        .from(jobs)
        .where(and(eq(jobs.tenantId, user.tenantId), eq(jobs.id, jobId), isNull(jobs.archivedAt)));
      if (!job) throw new UserError("That job was not found.");
    } else if (channelKey) {
      channel = getChannel(channelKey);
      if (!channel || !canSeeChannel(user.role, channel.key)) throw new UserError("That channel was not found.");
    } else {
      throw new UserError("Choose a job or a channel.");
    }

    // Attachment
    let fileId: number | null = null;
    if (file) {
      if (!can(user.role, "files.upload")) throw new ForbiddenError("You don't have permission to attach files.");
      try {
        const row = await saveUpload(file, { folder: job ? "working" : "other", jobId: job?.id ?? null }, user);
        fileId = row.id;
      } catch (e) {
        if (e instanceof Error && /larger than|isn't allowed/.test(e.message)) throw new UserError(e.message);
        throw e;
      }
    }

    // Who is mentioned? Individual handles + team groups (handles are unique per shop).
    const handles = parseMentions(body).map(cleanHandle);
    const groupRoles = new Set(MENTION_GROUPS.filter((g) => handles.includes(g.handle)).flatMap((g) => g.roles));
    const people = handles.length
      ? await db
          .select({ id: users.id, handle: users.handle, role: users.role })
          .from(users)
          .where(and(eq(users.tenantId, user.tenantId), eq(users.active, true)))
      : [];
    const mentioned = people
      .filter((p) => handles.includes(p.handle.toLowerCase()) || groupRoles.has(p.role))
      .filter((p) => p.id !== user.id)
      // Don't mention people into a channel they can't open.
      .filter((p) => !channel || canSeeChannel(p.role, channel.key))
      .map((p) => p.id);

    const where = job ? jobNo(job.number, await getJobPrefix(user.tenantId)) : `#${channel!.label}`;
    const link = job ? `/jobs/${job.number}?tab=chat` : `/messages?channel=${channel!.key}`;
    const firstName = user.name.split(" ")[0];
    const preview = body ? (body.length > 140 ? body.slice(0, 137) + "…" : body) : file ? `Attached ${file.name}` : "";

    const id = await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(messages)
        .values({ tenantId: user.tenantId, jobId: job?.id ?? null, channel: job ? null : channel!.key, authorId: user.id, body, fileId, important })
        .returning({ id: messages.id });
      if (mentioned.length) {
        await tx.insert(mentions).values(mentioned.map((userId) => ({ messageId: m!.id, userId }))).onConflictDoNothing();
        await notify(
          {
            tenantId: user.tenantId,
            userIds: mentioned,
            kind: "mention",
            title: `${important ? "Important: " : ""}${firstName} mentioned you ${job ? "on" : "in"} ${where}`,
            body: preview,
            link,
            actorId: user.id,
          },
          tx,
        );
      }
      if (job) {
        await logActivity(
          {
            tenantId: user.tenantId,
            action: "job.message",
            entityType: "job",
            entityId: job.id,
            jobId: job.id,
            customerId: job.customerId,
            actorId: user.id,
            summary: important ? "Posted an important message" : "Posted a message",
            data: { messageId: m!.id, preview: body.slice(0, 120) },
          },
          tx,
        );
      }
      return m!.id;
    });

    refresh();
    return { id };
  });
}
