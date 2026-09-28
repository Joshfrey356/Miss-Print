/**
 * Customer portal rules: what customers see and what they're allowed to do.
 * Pure and client-safe (no database, no "server-only"); unit-tested in tests/portal.test.ts.
 */
import { z } from "zod";
import type { Fulfillment, InvoiceStatus, JobStatus, QuoteStatus } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// What customers can see
// ---------------------------------------------------------------------------
/** Quotes a customer sees: never drafts. */
export const PORTAL_QUOTE_STATUSES: QuoteStatus[] = ["sent", "accepted", "declined", "expired", "converted"];
/** Invoices a customer sees: sent ones (not drafts, not voided). */
export const PORTAL_INVOICE_STATUSES: InvoiceStatus[] = ["sent", "partial", "paid"];
/** Proofs a customer sees: ones that were sent to them. */
export const PORTAL_PROOF_STATUSES = ["sent", "approved", "changes_requested"] as const;

export type Tone = "gray" | "blue" | "violet" | "amber" | "green" | "red" | "teal";

/** Plain words for a job's status, from the customer's side of the counter. */
export function customerStatus(status: JobStatus, fulfillment: Fulfillment = "pickup"): { label: string; tone: Tone } {
  switch (status) {
    case "new":
    case "needs_quote":
    case "quote_sent":
    case "approved":
      return { label: "Order received", tone: "blue" };
    case "waiting_artwork":
      return { label: "Waiting for your artwork", tone: "amber" };
    case "design":
    case "proof_ready":
      return { label: "In design", tone: "violet" };
    case "waiting_approval":
      return { label: "Waiting for your approval", tone: "amber" };
    case "approved_for_production":
    case "production":
    case "finishing":
    case "quality_check":
      return { label: "In production", tone: "teal" };
    case "ready_pickup":
      return { label: fulfillment === "ship" ? "Ready to ship" : "Ready for pickup", tone: "green" };
    case "scheduled_delivery":
      return { label: "Delivery scheduled", tone: "green" };
    case "scheduled_install":
      return { label: "Installation scheduled", tone: "green" };
    case "completed":
      return { label: "Completed", tone: "gray" };
    case "on_hold":
      return { label: "On hold", tone: "red" };
    case "cancelled":
      return { label: "Cancelled", tone: "gray" };
  }
}

export type TimelineStep = { key: string; label: string; state: "done" | "current" | "todo"; at: Date | null };

const STEP_OF: Record<JobStatus, string> = {
  new: "received",
  needs_quote: "received",
  quote_sent: "received",
  approved: "received",
  waiting_artwork: "artwork",
  design: "design",
  proof_ready: "design",
  waiting_approval: "proof",
  approved_for_production: "production",
  production: "production",
  finishing: "production",
  quality_check: "production",
  ready_pickup: "ready",
  scheduled_delivery: "ready",
  scheduled_install: "ready",
  completed: "done",
  on_hold: "",
  cancelled: "",
};

/**
 * The job's journey in plain steps (received → artwork/design → proof → production → ready → done),
 * with the date each step was reached from the status history. Staff notes and who did it are never included.
 */
export function customerTimeline(
  job: { status: JobStatus; needsDesign: boolean; needsProof: boolean; fulfillment: Fulfillment; createdAt: Date },
  history: { toStatus: JobStatus; changedAt: Date }[],
): TimelineStep[] {
  const ready = job.fulfillment === "install" ? "Installation scheduled" : job.fulfillment === "delivery" ? "Out for delivery" : job.fulfillment === "ship" ? "Ready to ship" : "Ready for pickup";
  const reachedArtwork = history.some((h) => h.toStatus === "waiting_artwork") || job.status === "waiting_artwork";
  const steps: { key: string; label: string; now?: string }[] = [
    { key: "received", label: "Order received" },
    ...(reachedArtwork ? [{ key: "artwork", label: "Artwork received", now: "Waiting for your artwork" }] : []),
    ...(job.needsDesign || job.needsProof ? [{ key: "design", label: "Design", now: "In design" }] : []),
    ...(job.needsProof ? [{ key: "proof", label: "Proof approved", now: "Waiting for your approval" }] : []),
    { key: "production", label: "In production" },
    { key: "ready", label: ready },
    { key: "done", label: job.fulfillment === "install" ? "Installed" : "Completed" },
  ];
  const keys = steps.map((s) => s.key);
  // on hold / cancelled: show progress up to the last step reached before it.
  let effective: JobStatus = job.status;
  if (job.status === "on_hold" || job.status === "cancelled") {
    const last = [...history].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime()).filter((h) => STEP_OF[h.toStatus]).at(-1);
    effective = last?.toStatus ?? "new";
  }
  let current = keys.indexOf(STEP_OF[effective]);
  if (current < 0) current = 0;
  // "Artwork received" is done once we've moved past waiting for it; "Proof approved" is done when production starts.
  const firstAt = (key: string) => {
    const hits = history.filter((h) => keys.indexOf(STEP_OF[h.toStatus]) >= keys.indexOf(key)).map((h) => h.changedAt.getTime());
    return hits.length ? new Date(Math.min(...hits)) : null;
  };
  return steps.map((s, i) => {
    const state: TimelineStep["state"] = job.status === "completed" || i < current ? "done" : i === current ? "current" : "todo";
    const at = s.key === "received" ? job.createdAt : state === "todo" ? null : s.key === "artwork" || s.key === "proof" ? (state === "done" ? firstAt(keys[i + 1]!) : null) : firstAt(s.key);
    return { key: s.key, label: state === "current" && s.now ? s.now : s.label, state, at };
  });
}

// ---------------------------------------------------------------------------
// Quotes: accepting and declining online
// ---------------------------------------------------------------------------
export type QuoteCheck = { ok: true } | { ok: false; reason: string };

/** Customers can answer a quote that was sent to them, isn't past its "valid until" date and isn't a job yet. */
export function quoteAnswerable(q: { status: QuoteStatus; validUntil: string | null; archivedAt?: Date | null }, today: string): QuoteCheck {
  if (q.archivedAt) return { ok: false, reason: "This quote is no longer available." };
  if (q.status === "converted") return { ok: false, reason: "This quote is already an order." };
  if (q.status === "accepted") return { ok: false, reason: "You already accepted this quote." };
  if (q.status === "declined") return { ok: false, reason: "This quote was declined." };
  if (q.status === "expired" || (q.validUntil && q.validUntil < today)) return { ok: false, reason: "This quote has expired. Please ask us for an updated price." };
  if (q.status !== "sent") return { ok: false, reason: "This quote isn't ready yet." };
  return { ok: true };
}

export type QuantityOptionLite = { quantity: number; recommendedCents: number };

/** The quantities a customer may pick for a line: the quoted one plus the priced alternatives. */
export function allowedQuantities(mainQty: number, options: QuantityOptionLite[] | null | undefined): number[] {
  return [...new Set([mainQty, ...(options ?? []).map((o) => o.quantity)])].sort((a, b) => a - b);
}

export const AcceptQuoteInput = z.object({
  name: z.string().trim().min(2, "Please type your full name.").max(120),
  agree: z.literal(true, { error: "Please check “I accept this quote”." }),
  note: z.string().trim().max(2000).optional().default(""),
  /** quote item id → chosen quantity (only for lines that offer choices). */
  quantities: z.record(z.string().regex(/^\d+$/), z.number().int().positive()).optional().default({}),
});
export type AcceptQuoteInput = z.infer<typeof AcceptQuoteInput>;

export const DeclineQuoteInput = z.object({
  reason: z.string().trim().min(3, "Please tell us why, so we can do better next time.").max(1000),
});

/** Check picked quantities against each line's choices. Returns readable lines for the record, or an error. */
export function checkQuantityChoices(
  items: { id: number; description: string; quantity: number; options: QuantityOptionLite[] | null | undefined }[],
  picked: Record<string, number>,
): { ok: true; lines: string[] } | { ok: false; error: string } {
  const lines: string[] = [];
  for (const [id, qty] of Object.entries(picked)) {
    const item = items.find((i) => String(i.id) === id);
    if (!item) return { ok: false, error: "Please choose quantities for the lines on this quote." };
    if (!allowedQuantities(item.quantity, item.options).includes(qty)) return { ok: false, error: `Please pick one of the quantities offered for “${item.description}”.` };
    if (qty !== item.quantity) lines.push(`${item.description}: ${qty.toLocaleString("en-US")} (quoted ${item.quantity.toLocaleString("en-US")})`);
  }
  return { ok: true, lines };
}

// ---------------------------------------------------------------------------
// Requests from customers
// ---------------------------------------------------------------------------
export type RequestKind = "reorder" | "quote" | "message";
export const REQUEST_KIND_LABELS: Record<RequestKind, string> = { reorder: "Reorder", quote: "Quote request", message: "Message" };

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
  .refine((s) => !Number.isNaN(Date.parse(s)), "Pick a date.");
const optionalYmd = z.union([ymd, z.literal("")]).optional().transform((v) => v || null);
const fileIds = z.array(z.number().int().positive()).max(20, "Up to 20 files, please.").optional().default([]);

export const ReorderRequestInput = z.object({
  kind: z.literal("reorder"),
  jobId: z.number().int().positive(),
  quantity: z.number({ error: "How many do you need?" }).int("How many do you need?").min(1, "How many do you need?").max(10_000_000),
  neededBy: optionalYmd,
  sameArtwork: z.boolean(),
  notes: z.string().trim().max(4000).optional().default(""),
  fileIds,
});

export const QuoteRequestInput = z.object({
  kind: z.literal("quote"),
  what: z.string().trim().min(3, "Tell us what you need.").max(200),
  quantity: z.string().trim().max(60).optional().default(""),
  size: z.string().trim().max(100).optional().default(""),
  neededBy: optionalYmd,
  notes: z.string().trim().max(4000).optional().default(""),
  fileIds,
});

export const MessageRequestInput = z.object({
  kind: z.literal("message"),
  subject: z.string().trim().min(2, "Add a subject.").max(200),
  body: z.string().trim().min(2, "Write your message.").max(4000),
  jobId: z.number().int().positive().nullable().optional().default(null),
  fileIds,
});

export const PortalRequestInput = z.discriminatedUnion("kind", [ReorderRequestInput, QuoteRequestInput, MessageRequestInput]);
export type PortalRequestInput = z.infer<typeof PortalRequestInput>;

/** Subject line + body text for a request, as staff see it in the inbox. */
export function describeRequest(r: PortalRequestInput, ctx: { jobLabel?: string | null } = {}): { subject: string; body: string | null; details: Record<string, unknown> } {
  switch (r.kind) {
    case "reorder":
      return {
        subject: `Reorder${ctx.jobLabel ? ` of ${ctx.jobLabel}` : ""}: ${r.quantity.toLocaleString("en-US")}`,
        body: r.notes || null,
        details: { quantity: r.quantity, neededBy: r.neededBy, sameArtwork: r.sameArtwork, fileIds: r.fileIds },
      };
    case "quote":
      return {
        subject: r.what,
        body: r.notes || null,
        details: { what: r.what, quantity: r.quantity || null, size: r.size || null, neededBy: r.neededBy, fileIds: r.fileIds },
      };
    case "message":
      return { subject: r.subject, body: r.body, details: { fileIds: r.fileIds } };
  }
}

/** Read the numbers the portal stored in portal_requests.details (it's jsonb, so check the shapes). */
export function requestDetails(d: Record<string, unknown> | null | undefined) {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    quantity: num(d?.quantity),
    neededBy: str(d?.neededBy),
    sameArtwork: d?.sameArtwork === true,
    what: str(d?.what),
    quantityText: typeof d?.quantity === "string" ? (d.quantity as string) : null,
    size: str(d?.size),
    fileIds: Array.isArray(d?.fileIds) ? (d!.fileIds as unknown[]).filter((x): x is number => Number.isInteger(x) && (x as number) > 0) : [],
  };
}

export const SignInEmail = z.string().trim().toLowerCase().email("Please enter a valid email address.").max(200);
