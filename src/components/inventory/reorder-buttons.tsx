"use client";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/use-action";
import { createSuggestedDraftsAction } from "@/app/(app)/inventory/actions";

/** One click → a draft purchase order per vendor with the suggested quantities. */
export function CreateDraftsButton({ vendorIds, label, variant = "primary" }: { vendorIds: number[]; label: string; variant?: "primary" | "secondary" }) {
  const [pending, run] = useServerAction();
  const router = useRouter();
  return (
    <Button
      variant={variant}
      disabled={pending || !vendorIds.length}
      onClick={() =>
        run(() => createSuggestedDraftsAction(vendorIds), {
          onSuccess: (r) => {
            const created = (r.data as { created: { id: number; number: number }[] }).created;
            if (created.length === 1) router.push(`/inventory/purchase-orders/${created[0]!.id}`);
            else router.push("/inventory/purchase-orders?status=draft");
          },
          success: vendorIds.length === 1 ? "Draft purchase order created" : "Draft purchase orders created",
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}
      {label}
    </Button>
  );
}
