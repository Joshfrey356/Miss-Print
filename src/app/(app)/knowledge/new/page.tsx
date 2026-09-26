import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canEditKnowledge } from "@/lib/admin/knowledge";
import { PageHeader } from "@/components/ui/page-header";
import { ArticleForm } from "../article-form";
import { getKnowledgeCategories } from "../categories";

export const metadata = { title: "New article" };

export default async function NewArticlePage() {
  const user = await requireUser();
  if (!canEditKnowledge(user.role)) redirect("/no-access");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New article" back={{ href: "/knowledge", label: "Knowledge" }} subtitle="Write down how something is done, so anyone can look it up." />
      <ArticleForm categories={await getKnowledgeCategories()} />
    </div>
  );
}
