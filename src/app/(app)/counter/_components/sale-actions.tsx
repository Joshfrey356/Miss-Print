"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2, Mail, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { useServerAction } from "@/components/use-action";
import { cancelSaleAction, emailReceiptAction } from "../actions";

export function EmailReceiptButton({ invoiceId, defaultEmail, size = "lg", variant = "secondary" }: { invoiceId: number; defaultEmail: string | null; size?: ButtonProps["size"]; variant?: ButtonProps["variant"] }) {
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState(defaultEmail ?? "");
  const [pending, start] = React.useTransition();
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        <Mail className="size-5" />
        Email receipt
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Email the receipt">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await emailReceiptAction(invoiceId, email);
                if (!r.ok) return void toast.error(r.error);
                toast.success(`Receipt sent to ${r.data!.to}`);
                setOpen(false);
              });
            }}
          >
            <Field label="Email address" htmlFor="rc-email" required>
              <Input id="rc-email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus className="h-12 text-base" placeholder="customer@example.com" />
            </Field>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button size="lg">Cancel</Button>
              </DialogClose>
              <Button type="submit" size="lg" variant="primary" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                Send receipt
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PrintReceiptButton({ size = "lg", variant = "primary" }: { size?: ButtonProps["size"]; variant?: ButtonProps["variant"] }) {
  return (
    <Button size={size} variant={variant} onClick={() => window.print()}>
      <Printer className="size-5" />
      Print receipt
    </Button>
  );
}

export function CancelSaleButton({ invoiceId }: { invoiceId: number }) {
  const router = useRouter();
  const [pending, run] = useServerAction();
  return (
    <Confirm
      title="Cancel this sale?"
      description="Nothing has been paid on it. The sale stays on record marked Void, and its job (if any) is cancelled."
      confirmLabel="Cancel the sale"
      onConfirm={() => run(() => cancelSaleAction(invoiceId), { onSuccess: () => router.push("/counter") })}
    >
      <Button size="lg" variant="ghost" className="text-red-700 hover:bg-red-50" disabled={pending}>
        <Ban className="size-5" />
        Cancel sale
      </Button>
    </Confirm>
  );
}
