"use client";
import { useRouter } from "next/navigation";
import { Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { useServerAction } from "@/components/use-action";
import { depositJobAction, depositQuoteAction } from "../actions";

/** "Take deposit" on a job (creates its invoice) or a quote (becomes a job, then invoiced). */
export function DepositButton({ kind, id }: { kind: "job" | "quote"; id: number }) {
  const router = useRouter();
  const [pending, run] = useServerAction();
  const go = () =>
    run(() => (kind === "job" ? depositJobAction(id) : depositQuoteAction(id)), {
      onSuccess: (r) => router.push(`/counter/sale/${(r.data as { id: number }).id}`),
    });
  const button = (
    <Button size="lg" variant="primary" disabled={pending} onClick={kind === "job" ? go : undefined}>
      {pending ? <Loader2 className="size-5 animate-spin" /> : <Wallet className="size-5" />}
      Take deposit
    </Button>
  );
  if (kind === "job") return button;
  return (
    <Confirm title="Turn this quote into a job?" description="Taking a deposit means the customer is going ahead: the quote becomes a job on the production board and gets an invoice." confirmLabel="Yes, make the job" danger={false} onConfirm={go}>
      {button}
    </Confirm>
  );
}
