import Link from "next/link";
import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Archive, BookOpen, Plus, Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { knowledgeArticles } from "@/lib/db/schema";
import { canEditKnowledge } from "@/lib/admin/knowledge";
import { getSettings } from "@/lib/settings";
import { timeAgo } from "@/lib/format";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { plainPreview } from "./markdown-lite";

export const metadata = { title: "Knowledge" };

type SP = { q?: string; archived?: string };

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const editor = canEditKnowledge(user.role);
  const showArchived = editor && sp.archived === "1";
  const qText = (sp.q ?? "").trim().slice(0, 100);
  const like = `%${qText.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const [rows, [archivedCount], { company }] = await Promise.all([
    db
      .select({ id: knowledgeArticles.id, title: knowledgeArticles.title, category: knowledgeArticles.category, body: knowledgeArticles.body, updatedAt: knowledgeArticles.updatedAt })
      .from(knowledgeArticles)
      .where(
        and(
          eq(knowledgeArticles.tenantId, user.tenantId),
          showArchived ? isNotNull(knowledgeArticles.archivedAt) : isNull(knowledgeArticles.archivedAt),
          qText ? or(ilike(knowledgeArticles.title, like), ilike(knowledgeArticles.body, like), ilike(knowledgeArticles.category, like)) : undefined,
        ),
      )
      .orderBy(asc(knowledgeArticles.category), qText ? desc(sql`${knowledgeArticles.title} ilike ${like}`) : asc(knowledgeArticles.title), asc(knowledgeArticles.title)),
    editor
      ? db
          .select({ n: sql<number>`count(*)::int` })
          .from(knowledgeArticles)
          .where(and(eq(knowledgeArticles.tenantId, user.tenantId), isNotNull(knowledgeArticles.archivedAt)))
      : Promise.resolve([{ n: 0 }]),
    getSettings(user.tenantId),
  ]);

  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(r.category, [...(groups.get(r.category) ?? []), r]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={showArchived ? "Archived articles" : "Knowledge"}
        subtitle={
          showArchived
            ? "Hidden from everyone else. Open one to restore it."
            : `How we do things ${company.name ? `at ${company.name}` : "here"} — pricing, checklists, phone numbers and more.`
        }
        back={showArchived ? { href: "/knowledge", label: "Knowledge" } : undefined}
        actions={
          editor && !showArchived ? (
            <LinkButton href="/knowledge/new" variant="primary" size="lg">
              <Plus className="size-5" /> New article
            </LinkButton>
          ) : undefined
        }
      />
      <form action="/knowledge" className="relative mb-6">
        {showArchived && <input type="hidden" name="archived" value="1" />}
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          name="q"
          defaultValue={qText}
          placeholder="Search articles, e.g. “banner” or “wrap”"
          aria-label="Search knowledge articles"
          className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-11 pr-4 text-base shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
      </form>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={BookOpen}
            title={qText ? `No articles match “${qText}”` : showArchived ? "No archived articles" : "No articles yet"}
            description={
              qText
                ? "Try a shorter word, or ask the owner to write it down."
                : editor
                  ? "Write down how things are done — pricing rules of thumb, checklists, who to call — so it's not just in one person's head."
                  : "The owner and managers will add how-to articles here."
            }
            action={
              editor && !qText && !showArchived ? (
                <LinkButton href="/knowledge/new" variant="primary">
                  <Plus className="size-4" /> Write the first article
                </LinkButton>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([cat, list]) => (
            <section key={cat}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{cat}</h2>
              <Card className="divide-y divide-slate-100">
                {list.map((a) => (
                  <Link key={a.id} href={`/knowledge/${a.id}`} className="block px-5 py-4 hover:bg-slate-50">
                    <p className="text-[17px] font-semibold text-slate-900">{a.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[15px] text-slate-600">{plainPreview(a.body) || "No text yet."}</p>
                    <p className="mt-1 text-xs text-slate-400">Updated {timeAgo(a.updatedAt)}</p>
                  </Link>
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}

      {editor && !showArchived && (archivedCount?.n ?? 0) > 0 && (
        <Link href="/knowledge?archived=1" className="mt-8 inline-flex items-center gap-2 text-[15px] text-slate-500 hover:text-slate-800">
          <Archive className="size-4" /> {archivedCount!.n} archived {archivedCount!.n === 1 ? "article" : "articles"}
        </Link>
      )}
    </div>
  );
}
