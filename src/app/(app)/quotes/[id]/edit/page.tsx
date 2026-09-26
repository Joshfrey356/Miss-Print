import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { builderOptions, quoteForBuilder } from "@/lib/quotes/builder-data";
import { db } from "@/lib/db";
import { quotes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/ui/page-header";
import { QuoteBuilder } from "@/components/quotes/quote-builder";
import { quoteNo } from "@/lib/format";

export const metadata = { title: "Edit Quote" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("quotes.edit");
  const id = Number((await params).id);
  if (!id) notFound();
  const [q] = await db.select({ number: quotes.number, status: quotes.status }).from(quotes).where(eq(quotes.id, id));
  if (!q) notFound();
  if (q.status === "converted") redirect(`/quotes/${id}`);
  const [opts, initial] = await Promise.all([builderOptions(), quoteForBuilder(id)]);
  if (!initial) notFound();
  return (
    <>
      <PageHeader title={`Edit ${quoteNo(q.number)}`} back={{ href: `/quotes/${id}`, label: quoteNo(q.number) }} />
      <QuoteBuilder {...opts} canSeeCost={can(user.role, "margins.view")} currentUserId={user.id} initial={initial} />
    </>
  );
}
