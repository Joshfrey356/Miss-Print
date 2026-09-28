"use client";
import * as React from "react";
import { Check, Copy, Loader2, Mail, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { emailPayLinkAction } from "../actions";

/** Invoice page: the invoice's "Pay online" link — copy it, show its QR code, or email it to the customer. */
export function PayOnlineActions({ invoiceId, url, qr, defaultEmail }: { invoiceId: number; url: string; qr: string; defaultEmail: string | null }) {
  const [copied, setCopied] = React.useState(false);
  const [showQr, setShowQr] = React.useState(false);
  const [emailOpen, setEmailOpen] = React.useState(false);
  const [email, setEmail] = React.useState(defaultEmail ?? "");
  const [pending, start] = React.useTransition();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setEmailOpen(true)}>
          <Mail className="size-4" /> Send pay link
        </Button>
        <Button onClick={() => setShowQr((v) => !v)}>
          <QrCode className="size-4" /> {showQr ? "Hide QR code" : "QR code"}
        </Button>
        <Button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              toast.error("Couldn't copy the link.");
            }
          }}
        >
          {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      {showQr && (
        // eslint-disable-next-line @next/next/no-img-element -- generated QR code (data URL)
        <img src={qr} alt="QR code: pay this invoice online" className="size-56 rounded-lg border border-slate-200 bg-white p-2" />
      )}
      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent title="Send a pay link" description="The customer gets an email with a link to pay the balance by card. The link always shows the current balance.">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await emailPayLinkAction(invoiceId, email);
                if (!r.ok) return void toast.error(r.error);
                toast.success(`Pay link sent to ${r.data!.to}`);
                setEmailOpen(false);
              });
            }}
          >
            <Field label="Email" htmlFor="payl-email" required>
              <Input id="payl-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </Field>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                Send
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
