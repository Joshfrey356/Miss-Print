import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { builderOptions, pickedCustomer } from "@/lib/quotes/builder-data";
import { PageHeader } from "@/components/ui/page-header";
import { QuoteBuilder } from "@/components/quotes/quote-builder";

export const metadata = { title: "New Quote" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ customerId?: string; title?: string }> }) {
  const user = await requirePagePermission("quotes.edit");
  const { customerId, title } = await searchParams;
  const [opts, customer] = await Promise.all([builderOptions(user.tenantId), customerId ? pickedCustomer(user.tenantId, Number(customerId)) : Promise.resolve(null)]);
  return (
    <>
      <PageHeader title="New quote" back={{ href: "/quotes", label: "Quotes" }} subtitle="Pick the customer and product — the recommended price appears as you type. You always set the final price." />
      <QuoteBuilder
        {...opts}
        canSeeCost={can(user.role, "margins.view")}
        currentUserId={user.id}
        initial={{ id: null, customer, contactId: customer?.contacts.find((c) => c.isPrimary)?.id ?? null, title: title?.slice(0, 200) ?? "", salespersonId: customer?.salespersonId ?? user.id, locationId: null, needsDesign: false, needsInstall: false, isRush: false, dueDate: null, validUntil: null, internalNotes: null, customerNotes: null, items: [] }}
      />
    </>
  );
}
