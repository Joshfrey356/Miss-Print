import "server-only";
import type { Customer, customerContacts } from "@/lib/db/schema";
import { today } from "@/lib/format";
import type { CustomerFormValues } from "@/app/(app)/customers/_components/customer-form";

/** Map a customer row (or nothing, for a new one) to the form's initial values. */
export function customerFormValues(c?: Customer | null, contact?: Pick<typeof customerContacts.$inferSelect, "name" | "title" | "email" | "phone"> | null): CustomerFormValues {
  return {
    isCompany: c?.isCompany ?? true,
    name: c?.name ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    website: c?.website ?? "",
    address: c?.address ?? "",
    city: c?.city ?? "",
    state: c ? (c.state ?? "") : "IN",
    zip: c?.zip ?? "",
    billingAddress: c?.billingAddress ?? "",
    paymentTerms: c?.paymentTerms ?? "due_on_receipt",
    taxExempt: c?.taxExempt ?? false,
    taxExemptId: c?.taxExemptId ?? "",
    poRequired: c?.poRequired ?? false,
    discountPercent: String(Math.round((c?.discountPct ?? 0) * 100)),
    salespersonId: c?.salespersonId ? String(c.salespersonId) : "",
    customerSince: c ? (c.customerSince ?? "") : today(),
    notes: c?.notes ?? "",
    contactName: contact?.name ?? "",
    contactTitle: contact?.title ?? "",
    contactEmail: contact?.email ?? "",
    contactPhone: contact?.phone ?? "",
  };
}
