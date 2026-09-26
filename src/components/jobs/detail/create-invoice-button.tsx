"use client";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/use-action";
import { createJobInvoice } from "@/app/(app)/jobs/actions";

export function CreateInvoiceButton({ jobId, size = "sm" }: { jobId: number; size?: "sm" | "md" }) {
  const router = useRouter();
  const [pending, run] = useServerAction();
  return (
    <Button
      size={size}
      variant="primary"
      disabled={pending}
      onClick={() => run(() => createJobInvoice(jobId), { onSuccess: (r) => router.push(`/money/invoices/${(r.data as { id: number }).id}`) })}
    >
      <FilePlus2 className="size-4" /> {pending ? "Creating…" : "Create invoice"}
    </Button>
  );
}
