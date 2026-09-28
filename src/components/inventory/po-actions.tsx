"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Loader2, Mail, PackageCheck, Pencil, Printer, Send } from "lucide-react";
import { toast } from "sonner";
import { Button, LinkButton } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm";
import { useServerAction } from "@/components/use-action";
import { fmtQty, parseQty, remainingOf, unitLabel } from "@/lib/inventory/math";
import { cancelPoAction, placeOrderAction, receivePoAction } from "@/app/(app)/inventory/actions";

export type PoActionLine = { id: number; description: string; quantity: number; receivedQuantity: number; unit: string | null; stock: boolean };

/** The buttons on a purchase order: edit, place/email, receive, print, cancel — as the status and role allow. */
export function PoActions({
  po,
  lines,
  vendor,
  emailPreview,
  canPurchase,
  canReceive,
  canCancel,
}: {
  po: { id: number; number: number; status: string; sentAt: string | null };
  lines: PoActionLine[];
  vendor: { name: string; email: string | null };
  emailPreview: { subject: string; text: string } | null;
  canPurchase: boolean;
  canReceive: boolean;
  canCancel: boolean;
}) {
  const [dialog, setDialog] = React.useState<"order" | "email" | "receive" | "cancel" | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");
  const [, run] = useServerAction();
  const router = useRouter();
  const draft = po.status === "draft";
  const open = po.status === "ordered" || po.status === "partial";
  return (
    <div className="flex flex-wrap gap-2">
      {draft && canPurchase && (
        <>
          <Button variant="primary" onClick={() => setDialog("order")}>
            <Send className="size-4" /> Place order
          </Button>
          <LinkButton href={`/inventory/purchase-orders/${po.id}/edit`}>
            <Pencil className="size-4" /> Edit
          </LinkButton>
        </>
      )}
      {open && canReceive && (
        <Button variant="success" onClick={() => setDialog("receive")}>
          <PackageCheck className="size-4" /> Receive
        </Button>
      )}
      {open && canPurchase && (
        <Button onClick={() => setDialog("email")}>
          <Mail className="size-4" /> {po.sentAt ? "Email again" : "Email to vendor"}
        </Button>
      )}
      <LinkButton href={`/inventory/purchase-orders/${po.id}/print`} prefetch={false}>
        <Printer className="size-4" /> Print
      </LinkButton>
      {canCancel && (draft || open) && (
        <Button variant="ghost" className="text-red-700" onClick={() => setDialog("cancel")}>
          <Ban className="size-4" /> Cancel order
        </Button>
      )}

      <PlaceOrderDialog
        key={dialog ?? "closed"}
        open={dialog === "order" || dialog === "email"}
        emailOnly={dialog === "email"}
        onOpenChange={(o) => !o && setDialog(null)}
        po={po}
        vendor={vendor}
        preview={emailPreview}
        onDone={() => {
          setDialog(null);
          router.refresh();
        }}
      />
      {open && (
        <ReceiveDialog
          key={`r-${dialog}`}
          open={dialog === "receive"}
          onOpenChange={(o) => !o && setDialog(null)}
          po={po}
          lines={lines}
          onDone={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Cancel PO-${po.number}?`}
        description={
          <span className="block space-y-2">
            <span className="block">It stays on record as cancelled. {po.status !== "draft" ? "Let the vendor know you've cancelled it." : ""}</span>
            <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason (optional), e.g. found it cheaper elsewhere" />
          </span>
        }
        confirmLabel="Cancel order"
        onConfirm={() => run(() => cancelPoAction(po.id, cancelReason || null), { onSuccess: () => router.refresh() })}
      />
    </div>
  );
}

function PlaceOrderDialog({
  open,
  emailOnly,
  onOpenChange,
  po,
  vendor,
  preview,
  onDone,
}: {
  open: boolean;
  emailOnly: boolean;
  onOpenChange: (o: boolean) => void;
  po: { id: number; number: number };
  vendor: { name: string; email: string | null };
  preview: { subject: string; text: string } | null;
  onDone: () => void;
}) {
  const [send, setSend] = React.useState(emailOnly || !!vendor.email);
  const [email, setEmail] = React.useState(vendor.email ?? "");
  const [message, setMessage] = React.useState("");
  const [save, setSave] = React.useState(!vendor.email);
  const [showText, setShowText] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const differs = email.trim() && email.trim().toLowerCase() !== (vendor.email ?? "").toLowerCase();
  const submit = () =>
    start(async () => {
      setError(null);
      const r = await placeOrderAction(po.id, { email: send ? email : null, message: message || null, saveEmail: !!differs && save });
      if (!r.ok) return setError(r.error);
      toast.success(r.data?.emailed ? `Emailed to ${r.data.emailed}` : "Marked as ordered");
      onDone();
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        wide
        title={emailOnly ? `Email PO-${po.number} to ${vendor.name}` : `Place order PO-${po.number}`}
        description={emailOnly ? undefined : "Marks it as ordered today. Email it to the vendor, or leave the box unticked if you phoned or ordered online."}
      >
        <div className="space-y-4">
          {!emailOnly && <Checkbox label={`Email the purchase order to ${vendor.name}`} checked={send} onChange={(e) => setSend(e.target.checked)} />}
          {send && (
            <>
              <Field label="Send to" htmlFor="po-to">
                <Input id="po-to" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="orders@vendor.com" autoFocus={!vendor.email} />
              </Field>
              {differs && <Checkbox label={`Save ${email.trim()} as ${vendor.name}'s email for next time`} checked={save} onChange={(e) => setSave(e.target.checked)} />}
              <Field label="Message (optional)" htmlFor="po-msg" hint="Added above the order.">
                <Textarea id="po-msg" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Please ship with Thursday's truck." />
              </Field>
              {preview && (
                <div>
                  <button type="button" onClick={() => setShowText((s) => !s)} className="text-sm font-medium text-brand-700 hover:underline">
                    {showText ? "Hide" : "See"} the email
                  </button>
                  {showText && (
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-700">
                      <b>{preview.subject}</b>
                      {"\n\n"}
                      {preview.text}
                    </pre>
                  )}
                </div>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[15px] font-medium text-red-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" size="lg" disabled={pending || (send && !email.trim())} onClick={submit}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {emailOnly ? "Send email" : send ? "Email & place order" : "Mark as ordered"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReceiveDialog({ open, onOpenChange, po, lines, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; po: { id: number; number: number }; lines: PoActionLine[]; onDone: () => void }) {
  const waiting = lines.filter((l) => remainingOf(l) > 0);
  const [qty, setQty] = React.useState<Record<number, string>>(() => Object.fromEntries(waiting.map((l) => [l.id, String(remainingOf(l))])));
  const [note, setNote] = React.useState("");
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [warned, setWarned] = React.useState(false);
  const receipts = waiting.map((l) => ({ lineId: l.id, quantity: parseQty(qty[l.id]) ?? 0 }));
  const over = waiting.filter((l) => (parseQty(qty[l.id]) ?? 0) > remainingOf(l));
  const submit = () => {
    setError(null);
    if (receipts.some((r) => r.quantity < 0)) return setError("Quantities can't be negative.");
    if (!receipts.some((r) => r.quantity > 0)) return setError("Enter what came in on at least one line.");
    if (over.length && !warned) {
      setWarned(true);
      return;
    }
    start(async () => {
      const r = await receivePoAction(po.id, receipts, note || null);
      if (!r.ok) return setError(r.error);
      toast.success(r.data?.status === "received" ? `PO-${po.number} fully received` : "Received — the rest is still on order");
      onDone();
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide title={`Receive PO-${po.number}`} description="Enter what actually came in. Anything short stays on order.">
        <div className="space-y-3">
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {waiting.map((l) => (
              <div key={l.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{l.description}</p>
                  <p className="text-sm text-slate-500">
                    {fmtQty(remainingOf(l))} {l.unit ? unitLabel(l.unit, remainingOf(l)) : ""} still to come
                    {l.receivedQuantity > 0 ? ` (of ${fmtQty(l.quantity)})` : ""}
                    {l.stock ? " · goes into stock" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" className="text-sm text-slate-500 hover:text-slate-800" onClick={() => setQty((q) => ({ ...q, [l.id]: "0" }))}>
                    None
                  </button>
                  <Input
                    aria-label={`Received of ${l.description}`}
                    inputMode="decimal"
                    className="w-32 text-right tabular"
                    value={qty[l.id] ?? ""}
                    onChange={(e) => {
                      setWarned(false);
                      setQty((q) => ({ ...q, [l.id]: e.target.value }));
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <Field label="Note (optional)" htmlFor="rcv-note">
            <Input id="rcv-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Packing slip #, backorder date…" />
          </Field>
          {warned && over.length > 0 && (
            <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[15px] text-amber-900">
              More than ordered on {over.map((l) => `“${l.description}”`).join(", ")}. If the vendor really sent extra, click Receive again.
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[15px] font-medium text-red-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="success" size="lg" disabled={pending} onClick={submit}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Receive
            </Button>
          </div>
          <p className="text-sm text-slate-500">
            Need to fix a count later? Use <Link href="/inventory" className="text-brand-700 hover:underline">the stock item&apos;s</Link> Adjust or Count.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
