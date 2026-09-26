import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Pencil } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { knowledgeArticles, users } from "@/lib/db/schema";
import { canEditKnowledge } from "@/lib/admin/knowledge";
import { fmtDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { MarkdownLite } from "../markdown-lite";
import { ArchiveButton } from "./archive-button";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return { title: "Knowledge" };
  const [a] = await db.select({ title: knowledgeArticles.title }).from(knowledgeArticles).where(eq(knowledgeArticles.id, id));
  return { title: a?.title ?? "Knowledge" };
}

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const editor = canEditKnowledge(user.role);
  const [a] = await db
    .select({
      id: knowledgeArticles.id,
      title: knowledgeArticles.title,
      category: knowledgeArticles.category,
      body: knowledgeArticles.body,
      updatedAt: knowledgeArticles.updatedAt,
      archivedAt: knowledgeArticles.archivedAt,
      by: users.name,
    })
    .from(knowledgeArticles)
    .leftJoin(users, eq(users.id, knowledgeArticles.updatedBy))
    .where(eq(knowledgeArticles.id, id));
  if (!a || (a.archivedAt && !editor)) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        back={{ href: a.archivedAt ? "/knowledge?archived=1" : "/knowledge", label: "Knowledge" }}
        title={a.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">{a.category}</Badge>
            {a.archivedAt && <Badge tone="amber">Archived</Badge>}
            <span>
              Updated {fmtDateTime(a.updatedAt)}
              {a.by ? ` by ${a.by}` : ""}
            </span>
          </span>
        }
        actions={
          editor ? (
            <>
              <ArchiveButton id={a.id} archived={Boolean(a.archivedAt)} title={a.title} />
              {!a.archivedAt && (
                <LinkButton href={`/knowledge/${a.id}/edit`} variant="primary">
                  <Pencil className="size-4" /> Edit
                </LinkButton>
              )}
            </>
          ) : undefined
        }
      />
      <Card>
        <CardBody className="px-6 py-6 sm:px-8">
          {a.body.trim() ? <MarkdownLite body={a.body} /> : <p className="text-slate-500">This article doesn&apos;t have any text yet.</p>}
        </CardBody>
      </Card>
    </div>
  );
}
