"use client";
import { useRouter } from "next/navigation";
import { Loader2, MinusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { useServerAction } from "@/components/use-action";
import { takeJobMaterialsNow } from "@/app/(app)/inventory/actions";

/** "Take from stock now": marks a job's reserved stock as used before its status moves past printing. */
export function UseNowButton({ jobId }: { jobId: number }) {
  const [pending, run] = useServerAction();
  const router = useRouter();
  return (
    <Confirm
      title="Take this job's stock off the shelf now?"
      description="Everything reserved for this job is recorded as used. (It happens by itself when the job moves past printing.)"
      confirmLabel="Take from stock"
      danger={false}
      onConfirm={() => run(() => takeJobMaterialsNow(jobId), { onSuccess: () => router.refresh() })}
    >
      <Button size="sm" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <MinusCircle className="size-4" />}
        Use now
      </Button>
    </Confirm>
  );
}
