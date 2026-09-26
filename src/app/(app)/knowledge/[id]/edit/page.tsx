import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { knowledgeArticles } from "@/lib/db/schema";
import { canEditKnowledge } from "@/lib/admin/knowledge";
import { PageHeader } from "@/components/ui/page-header";
import { ArticleForm } from "../../article-form";
import { getKnowledgeCategories } from "../../categories";

export const metadata = { title: "Edit article" };

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canEditKnowledge(user.role)) redirect("/no-access");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [a] = await db
    .select({ id: knowledgeArticles.id, title: knowledgeArticles.title, category: knowledgeArticles.category, body: knowledgeArticles.body })
    .from(knowledgeArticles)
    .where(eq(knowledgeArticles.id, id));
  if (!a) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Edit: ${a.title}`} back={{ href: `/knowledge/${a.id}`, label: "Back to article" }} />
      <ArticleForm article={a} categories={await getKnowledgeCategories()} />
    </div>
  );
}
