import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { getCustomer, getPrimaryContact, getSalespeople } from "@/lib/customers/queries";
import { customerFormValues } from "@/lib/customers/form-values";
import { TERMS_LABELS } from "@/lib/money/service";
import { CustomerForm } from "../../_components/customer-form";

export const metadata = { title: "Edit customer" };

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("customers.edit");
  const id = Number((await params).id);
  const customer = await getCustomer(user.tenantId, id);
  if (!customer) notFound();
  const [contact, salespeople] = await Promise.all([getPrimaryContact(user.tenantId, id), getSalespeople(user.tenantId)]);
  // Keep a no-longer-eligible salesperson selectable so saving doesn't silently drop them.
  const people = salespeople.map((u) => ({ id: u.id, name: u.name }));
  if (customer.salesperson && !people.some((p) => p.id === customer.salesperson!.id)) people.push({ id: customer.salesperson.id, name: customer.salesperson.name });
  return (
    <>
      <PageHeader title={`Edit ${customer.name}`} back={{ href: `/customers/${id}`, label: customer.name }} />
      <CustomerForm
        customerId={id}
        initial={customerFormValues(customer, contact)}
        salespeople={people}
        termsLabels={{ ...TERMS_LABELS }}
        cancelHref={`/customers/${id}`}
      />
    </>
  );
}
