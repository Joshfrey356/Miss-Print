"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { bool, runAction, str, type ActionResult } from "@/lib/actions";
import { connectStripe, disconnectStripe } from "@/lib/payments/connection";

/** Settings → Integrations: save the shop's Stripe keys (checked against Stripe unless told not to). */
export async function connectStripeAction(_prev: unknown, fd: FormData): Promise<ActionResult<{ accountName: string | null; checked: boolean }>> {
  return runAction(async () => {
    const user = await requirePermission("settings.manage");
    const { config } = await connectStripe(
      user.tenantId,
      { secretKey: str(fd, "secretKey") ?? "", webhookSecret: str(fd, "webhookSecret") ?? "", check: !bool(fd, "skipCheck") },
      { id: user.id, name: user.name },
    );
    revalidatePath("/settings/integrations");
    revalidatePath("/counter", "layout");
    return { accountName: config.accountName, checked: config.checked };
  }, "Stripe connected");
}

export async function disconnectStripeAction(): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("settings.manage");
    await disconnectStripe(user.tenantId, { id: user.id, name: user.name });
    revalidatePath("/settings/integrations");
    revalidatePath("/counter", "layout");
  }, "Stripe disconnected");
}
