import * as React from "react";
import Link from "next/link";
import { cleanHandle, MENTION_GROUPS } from "@/lib/messages/channels";
import type { Role } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

// URLs, job numbers (MP-10428) and @mentions, in one pass.
const TOKEN_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|\b(MP-\d{4,7})\b|(^|[^\w@])@([a-z][\w.-]{1,30})/gi;

/**
 * Message text with @mentions highlighted (yours stand out), links and MP-numbers clickable.
 * `handles` = every known user handle; `me` = the viewer's handle and role.
 */
export function MessageBody({
  body,
  handles,
  me,
  noLinks,
}: {
  body: string;
  handles: Set<string>;
  me?: { handle: string; role?: Role };
  /** Render links as plain text (when the whole message is already inside a link). */
  noLinks?: boolean;
}) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of body.matchAll(TOKEN_RE)) {
    const start = m.index!;
    if ((m[1] || m[2]) && noLinks) continue;
    if (m[1]) {
      out.push(body.slice(last, start));
      out.push(
        <a key={key++} href={m[1]} target="_blank" rel="noopener noreferrer" className="break-all text-brand-600 underline underline-offset-2">
          {m[1]}
        </a>,
      );
      last = start + m[0].length;
    } else if (m[2]) {
      out.push(body.slice(last, start));
      out.push(
        <Link key={key++} href={`/jobs/${m[2].slice(3)}`} className="font-medium text-brand-600 hover:underline">
          {m[2]}
        </Link>,
      );
      last = start + m[0].length;
    } else if (m[4]) {
      const raw = m[4];
      const h = cleanHandle(raw);
      const group = MENTION_GROUPS.find((g) => g.handle === h);
      if (!handles.has(h) && !group) continue;
      const atStart = start + (m[3]?.length ?? 0);
      const trailing = raw.match(/[.-]+$/)?.[0] ?? "";
      const tagText = "@" + raw.slice(0, raw.length - trailing.length);
      const mine = me && (me.handle.toLowerCase() === h || (group && me.role && group.roles.includes(me.role)));
      out.push(body.slice(last, atStart));
      out.push(
        <span
          key={key++}
          title={group ? group.label : undefined}
          className={cn("rounded font-semibold", mine ? "bg-amber-100 px-0.5 text-amber-900" : "text-brand-700")}
        >
          {tagText}
        </span>,
      );
      last = atStart + tagText.length;
    }
  }
  out.push(body.slice(last));
  return <>{out}</>;
}
