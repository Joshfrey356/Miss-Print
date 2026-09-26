import "server-only";
import { asc, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { knowledgeArticles } from "@/lib/db/schema";

export async function getKnowledgeCategories() {
  const rows = await db
    .selectDistinct({ category: knowledgeArticles.category })
    .from(knowledgeArticles)
    .where(isNull(knowledgeArticles.archivedAt))
    .orderBy(asc(knowledgeArticles.category));
  return rows.map((r) => r.category);
}
