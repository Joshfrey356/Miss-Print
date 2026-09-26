import { requirePagePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { getSalespeople } from "@/lib/customers/queries";
import { customerFormValues } from "@/lib/customers/form-values";
import { TERMS_LABELS } from "@/lib/money/service";
import { CustomerForm } from "../_components/customer-form";

export const metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const user = await requirePagePermission("customers.edit");
  const salespeople = await getSalespeople(user.tenantId);
  return (
    <>
      <PageHeader title="New customer" back={{ href: "/customers", label: "Customers" }} />
      <CustomerForm
        customerId={null}
        initial={customerFormValues()}
        salespeople={salespeople.map((u) => ({ id: u.id, name: u.name }))}
        termsLabels={{ ...TERMS_LABELS }}
        cancelHref="/customers"
      />
    </>
  );
}
