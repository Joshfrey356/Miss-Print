"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ForbiddenError, requireUser } from "@/lib/auth";
import { runAction, str, UserError, type ActionResult } from "@/lib/actions";
import { db } from "@/lib/db";
import { knowledgeArticles } from "@/lib/db/schema";
import { canEditKnowledge } from "@/lib/admin/knowledge";

type Prev = ActionResult | null;

async function requireEditor() {
  const user = await requireUser();
  if (!canEditKnowledge(user.role)) throw new ForbiddenError();
  return user;
}

const schema = z.object({
  title: z.string().min(3, "Give the article a title.").max(160, "That title is too long."),
  category: z.string().min(1, "Choose or type a category.").max(60, "That category name is too long."),
  body: z.string().max(50_000, "That article is too long."),
});

export async function saveArticle(_prev: Prev, fd: FormData): Promise<ActionResult> {
  let id = Number(fd.get("id")) || 0;
  const result = await runAction(async () => {
    const user = await requireEditor();
    const data = schema.parse({ title: str(fd, "title") ?? "", category: str(fd, "category") ?? "", body: String(fd.get("body") ?? "").trim() });
    if (id) {
      const [row] = await db
        .update(knowledgeArticles)
        .set({ ...data, updatedBy: user.id, updatedAt: new Date() })
        .where(eq(knowledgeArticles.id, id))
        .returning({ id: knowledgeArticles.id });
      if (!row) throw new UserError("That article no longer exists.");
    } else {
      const [row] = await db.insert(knowledgeArticles).values({ ...data, updatedBy: user.id }).returning({ id: knowledgeArticles.id });
      id = row!.id;
    }
    revalidatePath("/knowledge");
  });
  if (!result.ok) return result;
  redirect(`/knowledge/${id}`);
}

export async function setArticleArchived(id: number, archived: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireEditor();
    const [row] = await db
      .update(knowledgeArticles)
      .set({ archivedAt: archived ? new Date() : null, updatedBy: user.id })
      .where(eq(knowledgeArticles.id, id))
      .returning({ id: knowledgeArticles.id });
    if (!row) throw new UserError("That article no longer exists.");
    revalidatePath("/knowledge");
    revalidatePath(`/knowledge/${id}`);
  }, archived ? "Article archived" : "Article restored");
}
