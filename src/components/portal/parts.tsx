import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { dueLabel, fmtDate } from "@/lib/format";
import { customerStatus } from "@/lib/portal/rules";
import type { Fulfillment, InvoiceStatus, JobStatus, QuoteStatus } from "@/lib/db/schema";

export function JobStatusPill({ status, fulfillment }: { status: JobStatus; fulfillment?: Fulfillment }) {
  const s = customerStatus(status, fulfillment);
  return <Badge tone={s.tone} className="text-[13px]">{s.label}</Badge>;
}

const QUOTE_LABELS: Record<QuoteStatus, [string, "gray" | "blue" | "green" | "red" | "amber"]> = {
  draft: ["Draft", "gray"],
  sent: ["Waiting for you", "amber"],
  accepted: ["Accepted", "green"],
  declined: ["Declined", "gray"],
  expired: ["Expired", "gray"],
  converted: ["Ordered", "green"],
};
export function QuoteStatusPill({ status, expired }: { status: QuoteStatus; expired?: boolean }) {
  const [label, tone] = expired && status === "sent" ? (["Expired", "gray"] as const) : QUOTE_LABELS[status];
  return <Badge tone={tone} className="text-[13px]">{label}</Badge>;
}

export function InvoiceStatusPill({ status, balanceCents, overdue }: { status: InvoiceStatus; balanceCents: number; overdue?: boolean }) {
  if (status === "paid" || balanceCents <= 0) return <Badge tone="green" className="text-[13px]">Paid</Badge>;
  if (overdue) return <Badge tone="red" className="text-[13px]">Past due</Badge>;
  return <Badge tone={status === "partial" ? "blue" : "amber"} className="text-[13px]">{status === "partial" ? "Partly paid" : "Open"}</Badge>;
}

/** A tappable row: big enough for thumbs, with a chevron. */
export function RowLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 sm:px-5", className)}>
      <div className="min-w-0 flex-1">{children}</div>
      <ChevronRight className="size-5 shrink-0 text-slate-300" />
    </Link>
  );
}

export function Section({ title, action, children, className }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-[15px] text-slate-500 sm:px-5">{children}</p>;
}

export const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** "Due Friday" / "Due tomorrow" / "Was due Sep 12" (a customer isn't "3 days late"). */
export function dueText(ymd: string, now: string) {
  if (ymd < now) return `Was due ${fmtDate(ymd)}`;
  const l = dueLabel(ymd, now);
  return `Due ${l === "Today" || l === "Tomorrow" ? l.toLowerCase() : l}`;
}

/** Shown when the shop turned a portal feature off. */
export function Unavailable({ title, phone, children }: { title: string; phone?: string | null; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <p className="text-lg font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-[15px] text-slate-600">
        {children ?? "Please contact us instead"}
        {phone ? (
          <>
            {" "}— call{" "}
            <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="font-medium text-brand-700 hover:underline">
              {phone}
            </a>
          </>
        ) : null}
        .
      </p>
      <Link href="/portal/home" className="mt-4 inline-flex h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-[15px] font-medium text-slate-800 hover:bg-slate-50">
        Back to home
      </Link>
    </div>
  );
}
