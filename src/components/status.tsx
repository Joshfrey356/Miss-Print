import { AlertTriangle, Flame, Zap } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { STATUS_LABELS, STATUS_TONE } from "@/lib/jobs/workflow";
import type { InvoiceStatus, JobStatus, Priority, QuoteStatus } from "@/lib/db/schema";

export function JobStatusBadge({ status, short }: { status: JobStatus; short?: boolean }) {
  const label = short && status === "waiting_approval" ? "Awaiting Approval" : STATUS_LABELS[status];
  return <Badge tone={STATUS_TONE[status]}>{label}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  if (priority === "normal") return null;
  if (priority === "rush")
    return (
      <Badge tone="orange">
        <Zap className="size-3" />
        Rush
      </Badge>
    );
  return (
    <Badge tone="red">
      <Flame className="size-3" />
      Critical
    </Badge>
  );
}

export function OverdueBadge() {
  return (
    <Badge tone="red">
      <AlertTriangle className="size-3" />
      Overdue
    </Badge>
  );
}

const QUOTE: Record<QuoteStatus, [string, Tone]> = {
  draft: ["Draft", "gray"],
  sent: ["Sent", "blue"],
  accepted: ["Accepted", "green"],
  declined: ["Declined", "red"],
  expired: ["Expired", "gray"],
  converted: ["Converted to job", "green"],
};
export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const [l, t] = QUOTE[status];
  return <Badge tone={t}>{l}</Badge>;
}

const INVOICE: Record<InvoiceStatus, [string, Tone]> = {
  draft: ["Draft", "gray"],
  sent: ["Unpaid", "amber"],
  partial: ["Partially paid", "amber"],
  paid: ["Paid", "green"],
  void: ["Void", "gray"],
};
export function InvoiceStatusBadge({ status, overdue }: { status: InvoiceStatus; overdue?: boolean }) {
  if (overdue && (status === "sent" || status === "partial")) return <Badge tone="red">Overdue</Badge>;
  const [l, t] = INVOICE[status];
  return <Badge tone={t}>{l}</Badge>;
}
