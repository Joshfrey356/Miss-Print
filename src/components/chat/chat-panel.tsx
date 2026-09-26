"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Flag, Loader2, MessageSquare, Paperclip, SendHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { MessageBody } from "./message-body";
import { postMessage } from "@/lib/messages/actions";
import { MENTION_GROUPS } from "@/lib/messages/channels";
import type { ChatMessage, ChatUser } from "@/lib/messages/types";
import { fmtDate, fmtDateTime, fmtTime, timeAgo, today, ymdOf } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ChatTarget = { jobId: number } | { channel: string };

type Pending = ChatMessage & { pending?: true };

/**
 * A chat stream + composer. Used by <JobChat> and the /messages channels.
 * Polls for new messages every 15 s while the tab is visible.
 */
export function ChatPanel({
  target,
  messages,
  users,
  currentUserId,
  placeholder = "Write a message…",
  emptyTitle = "No messages yet",
  emptyDescription = "Start the conversation. Type @ to mention someone.",
  canAttach = true,
  className,
  listClassName,
}: {
  target: ChatTarget;
  messages: ChatMessage[];
  users: ChatUser[];
  currentUserId: number;
  placeholder?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  canAttach?: boolean;
  className?: string;
  /** Height/scroll classes for the message list (default: max-h-[32rem]). */
  listClassName?: string;
}) {
  const router = useRouter();
  const [optimistic, addOptimistic] = React.useOptimistic<Pending[], Pending>(messages, (state, m) => [...state, m]);
  const me = users.find((u) => u.id === currentUserId);
  const handles = React.useMemo(() => new Set(users.map((u) => u.handle.toLowerCase())), [users]);
  const fileBase = "jobId" in target ? "/api/files" : "/messages/file";

  // Poll for new messages while visible.
  React.useEffect(() => {
    const tick = () => document.visibilityState === "visible" && router.refresh();
    const t = setInterval(tick, 15000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router]);

  // Keep the newest message in view.
  const listRef = React.useRef<HTMLDivElement>(null);
  const nearBottom = React.useRef(true);
  const lastId = optimistic.at(-1)?.id;
  React.useLayoutEffect(() => {
    const el = listRef.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastId, optimistic.length]);
  // Images load after the first scroll — stay pinned to the bottom when they do.
  React.useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onLoad = () => nearBottom.current && (el.scrollTop = el.scrollHeight);
    el.addEventListener("load", onLoad, true);
    return () => el.removeEventListener("load", onLoad, true);
  }, []);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className={cn("min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5", listClassName ?? "max-h-[32rem]")}
      >
        {optimistic.length === 0 ? (
          <EmptyState icon={MessageSquare} title={emptyTitle} description={emptyDescription} compact />
        ) : (
          <MessageList messages={optimistic} handles={handles} me={me} fileBase={fileBase} />
        )}
      </div>
      <Composer
        target={target}
        users={users}
        currentUserId={currentUserId}
        placeholder={placeholder}
        canAttach={canAttach}
        onSend={async (fd, preview) => {
          nearBottom.current = true;
          addOptimistic(preview);
          const r = await postMessage(fd);
          if (!r.ok) toast.error(r.error);
          return r.ok;
        }}
        makePreview={(body, important, file) => ({
          id: -Date.now(),
          body,
          important,
          createdAt: new Date(),
          editedAt: null,
          author: { id: currentUserId, name: me?.name ?? "You", handle: me?.handle ?? "", color: me?.color ?? "#64748b" },
          file: file ? { id: 0, filename: file.name, mimeType: file.type } : null,
          pending: true,
        })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message list
// ---------------------------------------------------------------------------
function dayLabel(ymd: string) {
  const t = today();
  if (ymd === t) return "Today";
  if (ymd === today(-1)) return "Yesterday";
  return fmtDate(ymd, { year: ymd.slice(0, 4) !== t.slice(0, 4) });
}

function MessageList({ messages, handles, me, fileBase }: { messages: Pending[]; handles: Set<string>; me?: ChatUser; fileBase: string }) {
  let prev: Pending | undefined;
  return (
    <ol className="space-y-0.5">
      {messages.map((m) => {
        const day = ymdOf(m.createdAt);
        const newDay = !prev || ymdOf(prev.createdAt) !== day;
        const grouped =
          !newDay && prev && prev.author.id === m.author.id && !m.important && !prev.important && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60000;
        prev = m;
        return (
          <li key={m.id}>
            {newDay && (
              <div className="my-3 flex items-center gap-3 text-xs font-medium text-slate-400" suppressHydrationWarning>
                <span className="h-px flex-1 bg-slate-200" />
                {dayLabel(day)}
                <span className="h-px flex-1 bg-slate-200" />
              </div>
            )}
            <MessageRow m={m} grouped={Boolean(grouped)} handles={handles} me={me} fileBase={fileBase} />
          </li>
        );
      })}
    </ol>
  );
}

function MessageRow({ m, grouped, handles, me, fileBase }: { m: Pending; grouped: boolean; handles: Set<string>; me?: ChatUser; fileBase: string }) {
  return (
    <div
      className={cn(
        "group flex gap-3 rounded-lg px-2",
        grouped ? "py-0.5" : "pt-2 pb-1",
        m.important && "border-l-4 border-amber-400 bg-amber-50 py-2",
        m.pending && "opacity-60",
      )}
    >
      <div className="w-9 shrink-0">{!grouped && <Avatar name={m.author.name} color={m.author.color} className="size-9 text-xs" />}</div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[15px] font-semibold text-slate-900">{m.author.name}</span>
            <time
              dateTime={new Date(m.createdAt).toISOString()}
              title={fmtDateTime(m.createdAt)}
              className="text-xs text-slate-400"
              suppressHydrationWarning
            >
              {m.pending ? "Sending…" : timeAgo(m.createdAt)}
            </time>
            {m.important && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-200/70 px-1.5 text-xs font-semibold text-amber-900">
                <Flag className="size-3" /> Important
              </span>
            )}
          </div>
        )}
        {m.body && (
          <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-800" title={grouped ? fmtTime(m.createdAt) : undefined}>
            <MessageBody body={m.body} handles={handles} me={me ? { handle: me.handle, role: me.role } : undefined} />
          </div>
        )}
        {m.file && <Attachment file={m.file} href={m.pending ? null : `${fileBase}/${m.file.id}`} />}
      </div>
    </div>
  );
}

function Attachment({ file, href }: { file: NonNullable<ChatMessage["file"]>; href: string | null }) {
  const isImage = /^image\/(png|jpeg|gif|webp)$/.test(file.mimeType);
  if (isImage && href)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1.5 block w-fit">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={href} alt={file.filename} loading="lazy" className="max-h-64 max-w-full rounded-lg border border-slate-200 object-contain" />
      </a>
    );
  const inner = (
    <>
      {href ? <FileText className="size-5 shrink-0 text-slate-400" /> : <Loader2 className="size-5 shrink-0 animate-spin text-slate-400" />}
      <span className="min-w-0 truncate">{file.filename}</span>
      {href && <Download className="size-4 shrink-0 text-slate-400" />}
    </>
  );
  const cls = "mt-1.5 flex w-fit max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700";
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn(cls, "hover:bg-slate-50")}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

// ---------------------------------------------------------------------------
// Composer with @mention autocomplete
// ---------------------------------------------------------------------------
type Option = { handle: string; label: string; sub: string; color?: string | null; group?: boolean };

function Composer({
  target,
  users,
  currentUserId,
  placeholder,
  canAttach,
  onSend,
  makePreview,
}: {
  target: ChatTarget;
  users: ChatUser[];
  currentUserId: number;
  placeholder: string;
  canAttach: boolean;
  onSend: (fd: FormData, preview: Pending) => Promise<boolean>;
  makePreview: (body: string, important: boolean, file: File | null) => Pending;
}) {
  const [text, setText] = React.useState("");
  const [important, setImportant] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [ac, setAc] = React.useState<{ query: string; start: number; index: number } | null>(null);
  const [sending, start] = React.useTransition();
  const ta = React.useRef<HTMLTextAreaElement>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const allOptions = React.useMemo<Option[]>(
    () => [
      ...users
        .filter((u) => u.active !== false && u.id !== currentUserId)
        .map((u) => ({ handle: u.handle, label: u.name, sub: "@" + u.handle, color: u.color })),
      ...MENTION_GROUPS.map((g) => ({ handle: g.handle, label: g.label, sub: "@" + g.handle + " · everyone", group: true })),
    ],
    [users, currentUserId],
  );
  const options = React.useMemo(() => {
    if (!ac) return [];
    const q = ac.query.toLowerCase();
    return allOptions
      .filter((o) => !q || o.handle.toLowerCase().startsWith(q) || o.label.toLowerCase().split(/\s+/).some((p) => p.startsWith(q)))
      .slice(0, 8);
  }, [ac, allOptions]);

  const autosize = () => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  };
  React.useLayoutEffect(autosize, [text]);

  const detect = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart ?? el.value.length;
    const m = el.value.slice(0, caret).match(/(^|[\s(])@([\w.-]{0,30})$/);
    if (m) setAc((cur) => ({ query: m[2]!, start: caret - m[2]!.length - 1, index: cur && cur.query === m[2] ? cur.index : 0 }));
    else setAc(null);
  };

  const pick = (o: Option) => {
    const el = ta.current;
    if (!el || !ac) return;
    const caret = el.selectionStart ?? text.length;
    const insert = "@" + o.handle + " ";
    const next = text.slice(0, ac.start) + insert + text.slice(caret);
    setText(next);
    setAc(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = ac.start + insert.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const send = () => {
    const body = text.trim();
    if ((!body && !file) || sending) return;
    const fd = new FormData();
    if ("jobId" in target) fd.set("jobId", String(target.jobId));
    else fd.set("channel", target.channel);
    fd.set("body", body);
    if (important) fd.set("important", "on");
    if (file) fd.set("file", file);
    const preview = makePreview(body, important, file);
    const saved = { text, important, file };
    setText("");
    setImportant(false);
    setFile(null);
    setAc(null);
    start(async () => {
      const ok = await onSend(fd, preview);
      if (!ok) {
        setText(saved.text);
        setImportant(saved.important);
        setFile(saved.file);
      }
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (ac && options.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setAc({ ...ac, index: (ac.index + d + options.length) % options.length });
        return;
      }
      if ((e.key === "Enter" && !e.metaKey && !e.ctrlKey) || e.key === "Tab") {
        e.preventDefault();
        pick(options[ac.index] ?? options[0]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAc(null);
        return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div
      className="@container border-t border-slate-200 bg-white p-3 sm:px-5"
      onDragOver={(e) => canAttach && e.preventDefault()}
      onDrop={(e) => {
        if (!canAttach) return;
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) setFile(f);
      }}
    >
      <div className="relative">
        {ac && options.length > 0 && (
          <ul role="listbox" aria-label="Mention someone" className="absolute bottom-full left-0 z-20 mb-2 w-72 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
            {options.map((o, i) => (
              <li key={o.handle} role="option" aria-selected={i === ac.index}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o);
                  }}
                  onMouseEnter={() => setAc({ ...ac, index: i })}
                  className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left", i === ac.index && "bg-brand-50")}
                >
                  {o.group ? (
                    <span className="flex size-7 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">@</span>
                  ) : (
                    <Avatar name={o.label} color={o.color} className="size-7" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-slate-800">{o.label}</span>
                    <span className="block truncate text-xs text-slate-500">{o.sub}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={ta}
          value={text}
          rows={2}
          placeholder={placeholder}
          aria-label="Message"
          onChange={(e) => {
            setText(e.target.value);
            detect(e.target);
          }}
          onKeyDown={onKeyDown}
          onClick={(e) => detect(e.currentTarget)}
          onBlur={() => setTimeout(() => setAc(null), 100)}
          className="block max-h-[220px] min-h-[3.25rem] w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base leading-relaxed text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:text-[15px]"
        />
      </div>

      {file && (
        <div className="mt-2 flex w-fit max-w-full items-center gap-2 rounded-lg bg-slate-100 py-1.5 pl-3 pr-1.5 text-sm text-slate-700">
          <Paperclip className="size-4 shrink-0 text-slate-400" />
          <span className="min-w-0 truncate">{file.name}</span>
          <button type="button" onClick={() => setFile(null)} aria-label="Remove attachment" className="rounded p-1 text-slate-500 hover:bg-slate-200">
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        {canAttach && (
          <>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              title="Attach a file or photo"
              aria-label="Attach a file or photo"
              className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <Paperclip className="size-5" />
              <span className="hidden @md:inline">Attach</span>
            </button>
            <input
              ref={fileInput}
              type="file"
              hidden
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </>
        )}
        <button
          type="button"
          aria-pressed={important}
          onClick={() => setImportant((v) => !v)}
          title="Important messages are highlighted for everyone"
          className={cn(
            "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium",
            important ? "bg-amber-100 text-amber-900 ring-1 ring-amber-300" : "text-slate-600 hover:bg-slate-100",
          )}
        >
          <Flag className={cn("size-5", important && "fill-amber-400 text-amber-600")} />
          <span className="hidden @md:inline">{important ? "Important" : "Mark important"}</span>
          <span className="@md:hidden">Important</span>
        </button>
        <span className="ml-auto hidden min-w-0 truncate text-xs text-slate-400 @2xl:inline">Type @ to mention · Ctrl/⌘+Enter to send</span>
        <button
          type="button"
          onClick={send}
          disabled={sending || (!text.trim() && !file)}
          title="Send (Ctrl/⌘+Enter)"
          className="ml-auto inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-brand-500 px-4 text-[15px] font-semibold text-white shadow-sm hover:bg-brand-600 disabled:opacity-50 @2xl:ml-0"
        >
          {sending ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
          Send
        </button>
      </div>
    </div>
  );
}
