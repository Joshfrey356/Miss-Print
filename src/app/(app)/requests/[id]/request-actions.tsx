"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileText, Loader2, RotateCcw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { useServerAction } from "@/components/use-action";
import { createReorder, markHandled, reopen } from "../actions";

type Props = {
  id: number;
  kind: "reorder" | "quote" | "message";
  status: "new" | "handled";
  canCreateJob: boolean;
  canQuote: boolean;
  quoteHref: string;
  hasResult: boolean;
  reorder: { quantity: number | null; dueDate: string | null; notes: string | null; sameArtwork: boolean; minDate: string };
  recentQuotes: { id: number; label: string }[];
};

export function RequestActions(p: Props) {
  const [pending, run] = useServerAction();
  if (p.status === "handled")
    return (
      <Card>
        <CardBody>
          <Button className="w-full" disabled={pending} onClick={() => run(() => reopen(p.id))}>
            <Undo2 className="size-4" /> Move back to new
          </Button>
        </CardBody>
      </Card>
    );
  return (
    <Card>
      <CardHeader title="Next step" />
      <CardBody className="space-y-2.5">
        {p.kind === "reorder" && p.canCreateJob && !p.hasResult && <CreateReorder {...p} />}
        {p.kind !== "reorder" && p.canQuote && (
          <LinkButton href={p.quoteHref} variant="primary" className="w-full">
            <FileText className="size-4" /> Start a quote
          </LinkButton>
        )}
        <MarkHandled id={p.id} recentQuotes={p.recentQuotes} />
      </CardBody>
    </Card>
  );
}

function CreateReorder({ id, reorder }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(reorder.quantity ? String(reorder.quantity) : "");
  const [due, setDue] = useState(reorder.dueDate ?? "");
  const [notes, setNotes] = useState(reorder.notes ?? "");
  const [sameArtwork, setSameArtwork] = useState(reorder.sameArtwork);
  const [sameSpecs, setSameSpecs] = useState(reorder.sameArtwork);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const n = qty.trim() ? Number(qty.replace(/[,\s]/g, "")) : null;
      const r = await createReorder(id, { quantity: n, dueDate: due || null, notes: notes.trim() || null, sameArtwork, sameSpecs: sameArtwork && sameSpecs });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Reorder created");
      setOpen(false);
      if (r.data) router.push(`/jobs/${r.data.number}`);
    });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="primary" className="w-full" onClick={() => setOpen(true)}>
        <RotateCcw className="size-4" /> Create the reorder
      </Button>
      <DialogContent title="Create the reorder" description="Copies the original job — items, artwork and people — as a new job with what the customer asked for. Prices follow the usual reorder rules; check them on the new job.">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Quantity" hint="Only changes a single-line job. Empty = same as before.">
              <Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="Due date">
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
          </div>
          <Field label="Notes for the job">
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Checkbox checked={sameArtwork} onChange={(e) => setSameArtwork(e.target.checked)} label="Same artwork as last time" hint="Links the original's artwork files to the new job." />
          {sameArtwork && <Checkbox checked={sameSpecs} onChange={(e) => setSameSpecs(e.target.checked)} label="No changes at all — skip proof, straight to production" />}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={pending} onClick={save}>
              {pending && <Loader2 className="size-4 animate-spin" />} Create job
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MarkHandled({ id, recentQuotes }: { id: number; recentQuotes: { id: number; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [quoteId, setQuoteId] = useState(recentQuotes[0] ? String(recentQuotes[0].id) : "");
  const [jobNumber, setJobNumber] = useState("");
  const [pending, run] = useServerAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button className="w-full" onClick={() => setOpen(true)}>
        <CheckCircle2 className="size-4" /> Mark handled
      </Button>
      <DialogContent title="Mark handled" description="Optionally link what came of it, so the customer and your team can find it.">
        <div className="space-y-4">
          {recentQuotes.length > 0 && (
            <Field label="Quote made for it">
              <Select value={quoteId} onChange={(e) => setQuoteId(e.target.value)}>
                <option value="">None</option>
                {recentQuotes.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Job number (optional)" hint="Just the number, e.g. 10428.">
            <Input inputMode="numeric" value={jobNumber} onChange={(e) => setJobNumber(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => run(() => markHandled(id, { quoteId: quoteId ? Number(quoteId) : null, jobNumber: jobNumber ? Number(jobNumber) : null }), { onSuccess: () => setOpen(false) })}
            >
              Mark handled
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
