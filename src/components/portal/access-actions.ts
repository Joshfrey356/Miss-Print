"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { runAction } from "@/lib/actions";
import { invitePortalUser, revokePortalAccess, type SentPortalLink } from "@/lib/portal/links";

/** Staff: email a customer contact a sign-in link to the customer portal. */
export async function inviteToPortal(customerId: number, input: { contactId: number | null; email: string }) {
  return runAction<SentPortalLink>(async () => {
    const user = await requirePermission("customers.edit");
    const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(200).parse(input.email ?? "");
    const contactId = input.contactId ? z.number().int().positive().parse(input.contactId) : null;
    const r = await invitePortalUser(user.tenantId, Number(customerId), { contactId, email }, user);
    revalidatePath(`/customers/${customerId}`);
    return r;
  });
}

/** Staff: turn off portal access for an email (revokes its links and signs it out everywhere). */
export async function turnOffPortalAccess(customerId: number, email: string) {
  return runAction(async () => {
    const user = await requirePermission("customers.edit");
    const e = z.string().trim().toLowerCase().email().max(200).parse(email ?? "");
    await revokePortalAccess(user.tenantId, Number(customerId), e, user);
    revalidatePath(`/customers/${customerId}`);
  }, "Portal access turned off");
}
