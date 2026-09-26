"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, FilePlus2, Loader2, Mail, Printer, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Input, MoneyInput, Select, Textarea } from "@/components/ui/input";
import { useServerAction } from "@/components/use-action";
import { centsToInput, invoiceNo, money } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/lib/money/labels";
import { createInvoiceForJobAction, recordPaymentAction, sendReminderAction, voidInvoiceAction, voidPaymentAction } from "../actions";

/** "Create invoice" for a finished job. Opens the new invoice when done. */
export function CreateInvoiceButton({ jobId, size = "sm", variant = "primary", label = "Create invoice" }: { jobId: number; size?: ButtonProps["size"]; variant?: ButtonProps["variant"]; label?: string }) {
  const router = useRouter();
  const [pending, run] = useServerAction();
  return (
    <Button
      size={size}
      variant={variant}
      disabled={pending}
      onClick={() =>
        run(() => createInvoiceForJobAction(jobId), {
          onSuccess: (r) => {
            const d = r.data as { id: number; number: number } | undefined;
            if (d) router.push(`/money/invoices/${d.id}`);
          },
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}
      {label}
    </Button>
  );
}

/** Confirm, then email a payment reminder. */
export function SendReminderButton({
  invoiceId,
  invoiceNumber,
  customerName,
  balanceCents,
  hasEmail,
  size = "sm",
  variant = "secondary",
  label = "Send reminder",
}: {
  invoiceId: number;
  invoiceNumber: number;
  customerName: string;
  balanceCents: number;
  hasEmail: boolean;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, run] = useServerAction();
  if (!hasEmail)
    return (
      <Button size={size} variant={variant} disabled title="No email address on file for this customer">
        <Mail className="size-4" />
        No email
      </Button>
    );
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Send payment reminder?"
          description={
            <>
              {customerName} will get a friendly email about {invoiceNo(invoiceNumber)} with a balance of <strong>{money(balanceCents)}</strong>.
            </>
          }
        >
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                run(() => sendReminderAction(invoiceId), {
                  onSuccess: (r) => {
                    toast.success(`Reminder sent to ${(r.data as { to: string } | undefined)?.to ?? customerName}`);
                    setOpen(false);
                  },
                })
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Send reminder
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Void with a required reason. */
export function VoidButton({
  kind,
  id,
  title,
  description,
  size = "sm",
  label = "Void",
  disabled,
  disabledReason,
}: {
  kind: "invoice" | "payment";
  id: number;
  title: string;
  description?: React.ReactNode;
  size?: ButtonProps["size"];
  label?: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, run] = useServerAction();
  return (
    <>
      <Button size={size} variant="ghost" className="text-red-700 hover:bg-red-50" onClick={() => setOpen(true)} disabled={disabled} title={disabled ? disabledReason : undefined}>
        <Ban className="size-4" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={title} description={description}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!reason.trim()) return;
              run(() => (kind === "invoice" ? voidInvoiceAction(id, reason) : voidPaymentAction(id, reason)), { onSuccess: () => setOpen(false) });
            }}
            className="space-y-4"
          >
            <Field label="Reason" required hint="Kept on the record so everyone knows why.">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "invoice" ? "e.g. Duplicate invoice, job cancelled" : "e.g. Check bounced, entered twice"} autoFocus required maxLength={500} />
            </Field>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <Button type="submit" variant="danger" disabled={pending || !reason.trim()}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                {kind === "invoice" ? "Void invoice" : "Void payment"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Record a payment against an invoice. Amount defaults to the full balance. */
export function RecordPaymentButton({ invoiceId, balanceCents, today, size = "md" }: { invoiceId: number; balanceCents: number; today: string; size?: ButtonProps["size"] }) {
  const [open, setOpen] = React.useState(false);
  const [pending, run] = useServerAction();
  const [method, setMethod] = React.useState("check");
  return (
    <>
      <Button variant="success" size={size} onClick={() => setOpen(true)}>
        <Wallet className="size-4" />
        Record payment
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Record payment" description={`Balance due: ${money(balanceCents)}`}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              run(() => recordPaymentAction(invoiceId, fd), { onSuccess: () => setOpen(false) });
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount" required htmlFor="pay-amount">
                <MoneyInput id="pay-amount" name="amount" defaultValue={centsToInput(balanceCents)} required autoFocus className="h-12 text-lg" />
              </Field>
              <Field label="Date received" required htmlFor="pay-date">
                <Input id="pay-date" name="receivedOn" type="date" defaultValue={today} max={today} required className="h-12" />
              </Field>
            </div>
            <Field label="How did they pay?" required>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {PAYMENT_METHODS.map((m) => (
                  <label
                    key={m}
                    className={`flex h-11 cursor-pointer items-center justify-center rounded-lg border px-2 text-center text-sm font-medium ${method === m ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                  >
                    <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} className="sr-only" />
                    {m === "ach" ? "ACH" : PAYMENT_METHOD_LABELS[m]}
                  </label>
                ))}
              </div>
            </Field>
            <Field label={method === "check" ? "Check #" : method === "card" ? "Reference (last 4, approval #)" : "Reference"} htmlFor="pay-ref">
              <Input id="pay-ref" name="reference" maxLength={100} placeholder={method === "check" ? "e.g. 4821" : "Optional"} />
            </Field>
            <Field label="Notes" htmlFor="pay-notes">
              <Textarea id="pay-notes" name="notes" rows={2} maxLength={2000} placeholder="Optional" />
            </Field>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <Button type="submit" variant="success" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                Save payment
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PrintButton() {
  return (
    <Button onClick={() => window.print()}>
      <Printer className="size-4" />
      Print
    </Button>
  );
}
