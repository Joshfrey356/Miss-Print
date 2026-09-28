"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightCircle, Check, Copy, MoreHorizontal, Pencil, Printer, RotateCcw, Send, ThumbsDown, Archive } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/input";
import { useServerAction } from "@/components/use-action";
import { archiveQuote, convertQuote, duplicateQuote, sendQuote, setQuoteOutcome } from "@/app/(app)/quotes/actions";
import type { QuoteStatus } from "@/lib/db/schema";
import { useJobNo } from "@/components/shop-context";

export function QuoteActions({
  id,
  status,
  email,
  canEdit,
  canConvert,
  canPrint = false,
  jobNumber,
}: {
  id: number;
  status: QuoteStatus;
  email: string | null;
  canEdit: boolean;
  canConvert: boolean;
  /** Printable customer copy (it shows prices). */
  canPrint?: boolean;
  jobNumber: number | null;
}) {
  const router = useRouter();
  const jobNo = useJobNo();
  const [pending, run] = useServerAction();
  const [sending, setSending] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [emailIt, setEmailIt] = useState(!!email);

  const printLink = canPrint ? (
    <LinkButton href={`/quotes/${id}/print`} target="_blank" size="lg" aria-label="Print quote">
      <Printer className="size-4" /> Print
    </LinkButton>
  ) : null;

  if (status === "converted")
    return (
      <div className="flex flex-wrap items-center gap-2">
        {jobNumber && (
          <LinkButton href={`/jobs/${jobNumber}`} variant="primary" size="lg">
            Open job {jobNo(jobNumber)} <ArrowRightCircle className="size-4" />
          </LinkButton>
        )}
        {printLink}
      </div>
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canConvert && (status === "accepted" || status === "sent" || status === "draft") && (
        <Button variant={status === "accepted" ? "success" : "primary"} size="lg" disabled={pending} onClick={() => run(() => convertQuote(id))}>
          <ArrowRightCircle className="size-5" /> {pending ? "Creating job…" : "Convert to job"}
        </Button>
      )}
      {canEdit && status === "draft" && (
        <Button size="lg" onClick={() => setSending(true)}>
          <Send className="size-4" /> Send to customer
        </Button>
      )}
      {canEdit && status === "sent" && (
        <Button size="lg" variant="success" disabled={pending} onClick={() => run(() => setQuoteOutcome(id, "accepted"))}>
          <Check className="size-4" /> Customer accepted
        </Button>
      )}
      {canEdit && (
        <LinkButton href={`/quotes/${id}/edit`} size="lg">
          <Pencil className="size-4" /> Edit
        </LinkButton>
      )}
      {!canEdit && printLink}
      {canEdit && (
        <Dropdown>
          <DropdownTrigger asChild>
            <Button size="lg" aria-label="More">
              <MoreHorizontal className="size-5" />
            </Button>
          </DropdownTrigger>
          <DropdownContent>
            {status === "sent" && (
              <DropdownItem onSelect={() => setSending(true)}>
                <Send className="size-4 text-slate-400" /> Resend
              </DropdownItem>
            )}
            {(status === "sent" || status === "draft") && (
              <DropdownItem onSelect={() => setDeclining(true)}>
                <ThumbsDown className="size-4 text-slate-400" /> Customer declined
              </DropdownItem>
            )}
            {(status === "declined" || status === "expired" || status === "accepted") && (
              <DropdownItem onSelect={() => run(() => setQuoteOutcome(id, "draft"), { success: "Reopened" })}>
                <RotateCcw className="size-4 text-slate-400" /> Reopen as draft
              </DropdownItem>
            )}
            {canPrint && (
              <DropdownItem onSelect={() => window.open(`/quotes/${id}/print`, "_blank")}>
                <Printer className="size-4 text-slate-400" /> Print for the customer
              </DropdownItem>
            )}
            <DropdownItem onSelect={() => run(() => duplicateQuote(id))}>
              <Copy className="size-4 text-slate-400" /> Duplicate quote
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem onSelect={() => setArchiving(true)} className="text-red-600">
              <Archive className="size-4" /> Archive
            </DropdownItem>
          </DropdownContent>
        </Dropdown>
      )}

      <Dialog open={sending} onOpenChange={setSending}>
        <DialogContent title="Send quote" description="Email it, or just mark it sent if you handed it over in person or by phone.">
          <form action={(fd) => run(() => sendQuote(id, { email: emailIt ? String(fd.get("email") ?? "") : null, message: (fd.get("message") as string) || null }), { onSuccess: () => setSending(false) })} className="space-y-4">
            <Checkbox label="Email the quote to the customer" checked={emailIt} onChange={(e) => setEmailIt(e.target.checked)} />
            {emailIt && (
              <>
                <Field label="Email" required>
                  <Input name="email" type="email" defaultValue={email ?? ""} required />
                </Field>
                <Field label="Message (optional)">
                  <Textarea name="message" rows={3} />
                </Field>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setSending(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={pending}>
                <Send className="size-4" /> {emailIt ? "Send email" : "Mark as sent"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={declining} onOpenChange={setDeclining}>
        <DialogContent title="Customer declined" description="Knowing why helps with future pricing.">
          <form action={(fd) => run(() => setQuoteOutcome(id, "declined", String(fd.get("reason") ?? "")), { onSuccess: () => setDeclining(false) })} className="space-y-4">
            <Field label="Reason (optional)">
              <Input name="reason" list="lost-reasons" placeholder="Price, timing, went elsewhere…" />
              <datalist id="lost-reasons">
                <option value="Price" />
                <option value="Timing — didn't need it after all" />
                <option value="Went with online printer" />
                <option value="Went with another local shop" />
                <option value="No response" />
              </datalist>
            </Field>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setDeclining(false)}>Cancel</Button>
              <Button type="submit" variant="danger" disabled={pending}>
                Mark declined
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={archiving} onOpenChange={setArchiving} title="Archive this quote?" description="It will be hidden from lists but kept on file." confirmLabel="Archive" onConfirm={() => run(() => archiveQuote(id), { onSuccess: () => router.push("/quotes") })} />
    </div>
  );
}
