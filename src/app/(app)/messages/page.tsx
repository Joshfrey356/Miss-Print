import Link from "next/link";
import type { Metadata } from "next";
import { and, count, eq, isNull } from "drizzle-orm";
import { AtSign, ChevronLeft, ChevronRight, Flag, Hash, Lock, MessageSquare } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { notifications, type Role } from "@/lib/db/schema";
import { getActiveUsers } from "@/lib/lookups";
import { canSeeChannel, getChannel, visibleChannels } from "@/lib/messages/channels";
import {
  getChannelMessages,
  getChannelSummaries,
  getMentionsFor,
  getRecentJobConversations,
  type ChannelSummary,
  type JobConversation,
  type MentionItem,
} from "@/lib/messages/queries";
import { ChatPanel } from "@/components/chat/chat-panel";
import { MessageBody } from "@/components/chat/message-body";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { fmtDateTime, jobNo, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Messages" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function MessagesPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePagePermission("messages.use");
  const sp = await searchParams;
  const requested = typeof sp.channel === "string" ? sp.channel : null;
  const showMentions = sp.view === "mentions";
  const channelKey = requested && canSeeChannel(user.role, requested) ? requested : "general";
  const channel = getChannel(channelKey)!;
  // On phones we show the list until something is picked; desktop always shows a stream.
  const hasSelection = Boolean(requested) || showMentions;

  const [summaries, convos, users, stream, mentionItems, [{ unreadMentions }]] = await Promise.all([
    getChannelSummaries(user.role),
    getRecentJobConversations(14),
    getActiveUsers(),
    showMentions ? Promise.resolve([]) : getChannelMessages(channelKey),
    showMentions ? getMentionsFor(user.id, user.role) : Promise.resolve([] as MentionItem[]),
    db
      .select({ unreadMentions: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), eq(notifications.kind, "mention"), isNull(notifications.readAt))),
  ]);
  const handles = new Set(users.map((u) => u.handle.toLowerCase()));
  const me = { handle: user.handle, role: user.role };

  return (
    <div>
      <div className={cn("mb-5", hasSelection && "hidden lg:block")}>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Messages</h1>
        <p className="mt-1 text-[15px] text-slate-500">Team channels and job conversations. Questions about a job belong in that job&apos;s chat.</p>
      </div>

      <div className="lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-6">
        {/* ---- Left: conversation list ---- */}
        <aside className={cn("space-y-5 lg:h-[calc(100dvh-13rem)] lg:overflow-y-auto lg:pr-1", hasSelection && "hidden lg:block")}>
          <ListSection title="Channels">
            {visibleChannels(user.role).map((c) => (
              <ChannelLink key={c.key} c={c} summary={summaries[c.key]} active={!showMentions && channelKey === c.key && hasSelection} restricted={Boolean(c.roles)} />
            ))}
          </ListSection>

          <ListSection title="For you">
            <Link
              href="/messages?view=mentions"
              className={cn("flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-white", showMentions && "bg-white ring-1 ring-brand-200")}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <AtSign className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-slate-800">Mentions</span>
                <span className="block truncate text-sm text-slate-500">Messages that mention you</span>
              </span>
              {unreadMentions > 0 && <span className="rounded-full bg-red-500 px-2 text-xs font-bold leading-5 text-white">{unreadMentions}</span>}
              <ChevronRight className="size-4 text-slate-300 lg:hidden" />
            </Link>
          </ListSection>

          <ListSection title="Recent job conversations" hint="Last 14 days">
            {convos.length === 0 ? (
              <p className="px-3 py-3 text-sm text-slate-500">No job has had messages in the last 2 weeks.</p>
            ) : (
              convos.map((c) => <ConversationLink key={c.jobId} c={c} />)
            )}
          </ListSection>
        </aside>

        {/* ---- Right: selected stream ---- */}
        <section className={cn(!hasSelection && "hidden lg:block")}>
          <Link href="/messages" className="mb-3 inline-flex items-center gap-1 text-[15px] font-medium text-brand-600 lg:hidden">
            <ChevronLeft className="size-5" /> All conversations
          </Link>
          {showMentions ? (
            <div className="flex h-[calc(100dvh-12.5rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:h-[calc(100dvh-13rem)]">
              <StreamHeader icon={<AtSign className="size-5" />} title="Mentions" description="Messages that mention you or your team, newest first" />
              <div className="min-h-0 flex-1 overflow-y-auto">
                {mentionItems.length === 0 ? (
                  <EmptyState icon={AtSign} title="Nobody has mentioned you yet" description="When someone types @your-name in a job chat or channel, it shows up here." />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {mentionItems.map((m) => (
                      <MentionRow key={m.id} m={m} handles={handles} me={me} />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-[calc(100dvh-12.5rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:h-[calc(100dvh-13rem)]">
              <StreamHeader
                icon={channel.roles ? <Lock className="size-5" /> : <Hash className="size-5" />}
                title={channel.label}
                description={channel.description}
              />
              <ChatPanel
                key={channel.key}
                target={{ channel: channel.key }}
                messages={stream}
                users={users}
                currentUserId={user.id}
                canAttach={can(user.role, "files.upload")}
                placeholder={`Message #${channel.label}…`}
                emptyTitle={`Nothing in #${channel.label} yet`}
                emptyDescription="Post shop news or a quick question for the team. For a specific job, use that job's chat instead."
                className="min-h-0 flex-1"
                listClassName="h-full"
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ListSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function ChannelLink({ c, summary, active, restricted }: { c: { key: string; label: string }; summary?: ChannelSummary; active: boolean; restricted: boolean }) {
  return (
    <Link href={`/messages?channel=${c.key}`} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-white", active && "bg-white ring-1 ring-brand-200")}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-200/70 text-slate-600">
        {restricted ? <Lock className="size-4" /> : <Hash className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] font-semibold text-slate-800">{c.label}</span>
          {summary?.lastAt && (
            <span className="shrink-0 text-xs text-slate-400" suppressHydrationWarning>
              {timeAgo(summary.lastAt)}
            </span>
          )}
        </span>
        <span className="block truncate text-sm text-slate-500">
          {summary?.lastBody ? `${summary.lastAuthor?.split(" ")[0]}: ${summary.lastBody}` : "No messages yet"}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-slate-300 lg:hidden" />
    </Link>
  );
}

function ConversationLink({ c }: { c: JobConversation }) {
  return (
    <Link href={`/jobs/${c.jobNumber}?tab=chat`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-white">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        <MessageSquare className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] text-slate-800">
            <span className="font-semibold">{jobNo(c.jobNumber)}</span> <span className="text-slate-600">{c.jobTitle}</span>
          </span>
          <span className="shrink-0 text-xs text-slate-400" suppressHydrationWarning>
            {timeAgo(c.lastAt)}
          </span>
        </span>
        <span className="flex items-center gap-1 truncate text-sm text-slate-500">
          {c.important && <Flag className="size-3.5 shrink-0 fill-amber-400 text-amber-600" />}
          <span className="truncate">
            {c.lastAuthor.split(" ")[0]}: {c.lastBody || "Sent a file"}
          </span>
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-slate-300 lg:hidden" />
    </Link>
  );
}

function StreamHeader({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
      <span className="text-slate-400">{icon}</span>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="truncate text-sm text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function MentionRow({ m, handles, me }: { m: MentionItem; handles: Set<string>; me: { handle: string; role: Role } }) {
  return (
    <li>
      <Link href={m.href} className="flex gap-3 px-4 py-3.5 hover:bg-slate-50 sm:px-5">
        <Avatar name={m.author.name} color={m.author.color} className="size-9" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[15px] font-semibold text-slate-900">{m.author.name}</span>
            <span className="text-sm text-brand-700">
              {m.source.kind === "job" ? (
                <>
                  on <span className="font-medium">{jobNo(m.source.number)}</span> · {m.source.title}
                </>
              ) : (
                <>in #{m.source.label}</>
              )}
            </span>
            <time className="text-xs text-slate-400" title={fmtDateTime(m.createdAt)} suppressHydrationWarning>
              {timeAgo(m.createdAt)}
            </time>
          </div>
          <p className={cn("mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-[15px] text-slate-700", m.important && "font-medium")}>
            {m.important && <Flag className="mr-1 inline size-3.5 fill-amber-400 text-amber-600" />}
            <MessageBody body={m.body || (m.file ? `Attached ${m.file.filename}` : "")} handles={handles} me={me} noLinks />
          </p>
        </div>
        <ChevronRight className="mt-2 size-4 shrink-0 text-slate-300" />
      </Link>
    </li>
  );
}
