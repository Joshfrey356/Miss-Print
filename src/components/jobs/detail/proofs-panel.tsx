"use client";
import { useState } from "react";
import { CheckCircle2, Copy, Lock, MessageSquareWarning, Send, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { FileUploader } from "@/components/file-uploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useServerAction } from "@/components/use-action";
import { recordProofApproval, sendProof } from "@/app/(app)/jobs/actions";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type ProofRow = {
  proof: {
    id: number;
    version: number;
    status: "draft" | "sent" | "approved" | "changes_requested" | "superseded";
    note: string | null;
    sentAt: Date | null;
    sentTo: string | null;
    respondedAt: Date | null;
    responderName: string | null;
    responderEmail: string | null;
    customerComment: string | null;
    fileId: number;
    createdAt: Date;
  };
  filename: string;
  mimeType: string;
  sentByName: string | null;
};

export function ProofsPanel({ jobId, proofs, defaultEmail, canSend }: { jobId: number; proofs: ProofRow[]; defaultEmail: string | null; canSend: boolean }) {
  const [sending, setSending] = useState<ProofRow | null>(null);
  const [approving, setApproving] = useState<ProofRow | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, run] = useServerAction();
  const approved = proofs.find((p) => p.proof.status === "approved");
  const latest = proofs[0];

  return (
    <div>
      {approved && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <Lock className="size-5 text-emerald-600" />
          <div className="text-sm">
            <p className="font-semibold text-emerald-800">Proof V{approved.proof.version} is APPROVED — print this version.</p>
            <p className="text-emerald-700">
              Approved by {approved.proof.responderName ?? "customer"}
              {approved.proof.responderEmail ? ` (${approved.proof.responderEmail})` : ""} on {fmtDateTime(approved.proof.respondedAt)}
            </p>
          </div>
        </div>
      )}

      {proofs.length === 0 && <p className="mb-3 text-sm text-slate-500">No proofs yet. Upload the first proof below — it becomes Proof V1.</p>}

      <ul className="space-y-3">
        {proofs.map((p) => {
          const isImage = p.mimeType.startsWith("image/");
          const actionable = canSend && p === latest && p.proof.status !== "approved" && p.proof.status !== "superseded";
          return (
            <li key={p.proof.id} className={cn("flex gap-4 rounded-xl border p-3", p.proof.status === "approved" ? "border-emerald-300 bg-emerald-50/40" : p.proof.status === "superseded" ? "border-slate-200 opacity-70" : "border-slate-200")}>
              <a href={`/api/files/${p.proof.fileId}`} target="_blank" rel="noreferrer" className="shrink-0">
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/files/${p.proof.fileId}`} alt={`Proof V${p.proof.version}`} className="h-24 w-20 rounded border border-slate-200 bg-white object-contain" />
                ) : (
                  <span className="flex h-24 w-20 items-center justify-center rounded border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">PDF</span>
                )}
              </a>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold text-slate-900">Proof V{p.proof.version}</span>
                  <ProofBadge status={p.proof.status} />
                </div>
                <p className="mt-0.5 truncate text-sm text-slate-500">{p.filename}</p>
                {p.proof.note && <p className="mt-1 text-sm text-slate-700">“{p.proof.note}”</p>}
                <p className="mt-1 text-xs text-slate-500">
                  Uploaded {fmtDateTime(p.proof.createdAt)}
                  {p.proof.sentAt && ` · Sent to ${p.proof.sentTo} ${fmtDateTime(p.proof.sentAt)}${p.sentByName ? ` by ${p.sentByName}` : ""}`}
                </p>
                {p.proof.status === "changes_requested" && p.proof.customerComment && (
                  <div className="mt-2 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <MessageSquareWarning className="mt-0.5 size-4 shrink-0" />
                    <span>
                      <strong>{p.proof.responderName ?? "Customer"}:</strong> {p.proof.customerComment}
                    </span>
                  </div>
                )}
                {p.proof.status === "superseded" && p.proof.customerComment && (
                  <p className="mt-1 text-xs text-slate-500">Customer asked: “{p.proof.customerComment}”</p>
                )}
                {actionable && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" onClick={() => setSending(p)}>
                      <Send className="size-4" /> {p.proof.status === "sent" ? "Resend proof" : "Send proof"}
                    </Button>
                    <Button size="sm" onClick={() => setApproving(p)}>
                      <UserCheck className="size-4" /> Approved in person / by phone
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {canSend && (
        <div className="mt-4">
          <FileUploader folder="proof" jobId={jobId} compact label={`Upload Proof V${(latest?.proof.version ?? 0) + 1}`} accept="image/*,application/pdf" />
          <p className="mt-1 text-xs text-slate-500">Old proofs are never overwritten — every upload is a new version.</p>
        </div>
      )}

      <Dialog open={!!sending} onOpenChange={(o) => !o && setSending(null)}>
        {sending && (
          <DialogContent title={`Send Proof V${sending.proof.version}`} description="The customer gets a secure link to approve or request changes. No account needed.">
            <form
              action={(fd) =>
                run(() => sendProof(sending.proof.id, String(fd.get("to") ?? ""), (fd.get("message") as string) || null), {
                  onSuccess: (r) => {
                    setSending(null);
                    setLink((r.data as { link?: string })?.link ?? null);
                  },
                })
              }
              className="space-y-4"
            >
              <Field label="Customer email" required>
                <Input name="to" type="email" defaultValue={defaultEmail ?? ""} required />
              </Field>
              <Field label="Message (optional)">
                <Textarea name="message" rows={3} placeholder="Updated the hours and logo as requested." />
              </Field>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setSending(null)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={pending}>
                  <Send className="size-4" /> {pending ? "Sending…" : "Send proof"}
                </Button>
              </div>
            </form>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!link} onOpenChange={(o) => !o && setLink(null)}>
        {link && (
          <DialogContent title="Proof sent" description="You can also text or email this link to the customer yourself.">
            <div className="flex gap-2">
              <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              <Button
                onClick={() => {
                  navigator.clipboard.writeText(link);
                  toast.success("Link copied");
                }}
              >
                <Copy className="size-4" /> Copy
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!approving} onOpenChange={(o) => !o && setApproving(null)}>
        {approving && (
          <DialogContent title={`Record approval of Proof V${approving.proof.version}`} description="Use this when the customer approved at the counter or over the phone. Your name is recorded with it.">
            <form action={(fd) => run(() => recordProofApproval(approving.proof.id, String(fd.get("name") ?? "")), { onSuccess: () => setApproving(null) })} className="space-y-4">
              <Field label="Who approved it?" required>
                <Input name="name" required placeholder="Customer's name" autoFocus />
              </Field>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setApproving(null)}>Cancel</Button>
                <Button type="submit" variant="success" disabled={pending}>
                  <CheckCircle2 className="size-4" /> Mark approved
                </Button>
              </div>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function ProofBadge({ status }: { status: ProofRow["proof"]["status"] }) {
  switch (status) {
    case "approved":
      return (
        <Badge tone="green">
          <Lock className="size-3" /> Approved
        </Badge>
      );
    case "sent":
      return <Badge tone="amber">Waiting for customer</Badge>;
    case "changes_requested":
      return <Badge tone="red">Changes requested</Badge>;
    case "superseded":
      return <Badge>Replaced</Badge>;
    default:
      return <Badge tone="violet">Not sent yet</Badge>;
  }
}
