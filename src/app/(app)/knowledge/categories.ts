import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { knowledgeArticles } from "@/lib/db/schema";

export async function getKnowledgeCategories(tenantId: number) {
  const rows = await db
    .selectDistinct({ category: knowledgeArticles.category })
    .from(knowledgeArticles)
    .where(and(eq(knowledgeArticles.tenantId, tenantId), isNull(knowledgeArticles.archivedAt)))
    .orderBy(asc(knowledgeArticles.category));
  return rows.map((r) => r.category);
}
