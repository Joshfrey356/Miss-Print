/**
 * Job workflow: statuses, board columns and "what happens next".
 * Pure functions, safe on client and server.
 */
import type { Fulfillment, JobStatus, Priority } from "@/lib/db/schema";

export const STATUS_LABELS: Record<JobStatus, string> = {
  new: "New",
  needs_quote: "Needs Quote",
  quote_sent: "Quote Sent",
  approved: "Approved",
  waiting_artwork: "Waiting for Artwork",
  design: "Design",
  proof_ready: "Proof Ready",
  waiting_approval: "Waiting for Customer Approval",
  approved_for_production: "Approved for Production",
  production: "Production",
  finishing: "Finishing",
  quality_check: "Quality Check",
  ready_pickup: "Ready for Pickup",
  scheduled_delivery: "Scheduled for Delivery",
  scheduled_install: "Scheduled for Installation",
  completed: "Completed",
  on_hold: "On Hold",
  cancelled: "Cancelled",
};

/** Short labels for tight spaces (board cards, TV). */
export const STATUS_SHORT: Record<JobStatus, string> = {
  ...STATUS_LABELS,
  waiting_approval: "Awaiting Approval",
  approved_for_production: "Ready to Print",
  scheduled_delivery: "Delivery",
  scheduled_install: "Install",
};

export type StatusTone = "gray" | "blue" | "violet" | "amber" | "green" | "red" | "teal";
export const STATUS_TONE: Record<JobStatus, StatusTone> = {
  new: "gray",
  needs_quote: "gray",
  quote_sent: "gray",
  approved: "blue",
  waiting_artwork: "amber",
  design: "violet",
  proof_ready: "violet",
  waiting_approval: "amber",
  approved_for_production: "blue",
  production: "teal",
  finishing: "teal",
  quality_check: "teal",
  ready_pickup: "green",
  scheduled_delivery: "green",
  scheduled_install: "green",
  completed: "gray",
  on_hold: "red",
  cancelled: "red",
};

export const OPEN_STATUSES = (Object.keys(STATUS_LABELS) as JobStatus[]).filter(
  (s) => s !== "completed" && s !== "cancelled",
);
/** Statuses that count as "work still to do" for due-date / overdue purposes. */
export const ACTIVE_STATUSES = OPEN_STATUSES.filter((s) => s !== "on_hold");
export const READY_STATUSES: JobStatus[] = ["ready_pickup", "scheduled_delivery", "scheduled_install"];

export const PRIORITY_LABELS: Record<Priority, string> = { normal: "Normal", rush: "Rush", critical: "Critical" };
export const FULFILLMENT_LABELS: Record<Fulfillment, string> = {
  pickup: "Customer pickup",
  delivery: "Delivery",
  install: "Installation",
  ship: "Ship",
};

// ---------------------------------------------------------------------------
// Production board
// ---------------------------------------------------------------------------
export type BoardColumn = {
  key: string;
  title: string;
  statuses: JobStatus[];
  /** Status a job gets when dropped into this column. */
  dropStatus: JobStatus;
  /** Which department usually owns this column (for filters). */
  department: "front" | "design" | "production" | "install" | "done";
};

export const BOARD_COLUMNS: BoardColumn[] = [
  { key: "incoming", title: "Incoming", statuses: ["new", "needs_quote", "quote_sent", "approved"], dropStatus: "approved", department: "front" },
  { key: "artwork", title: "Needs Artwork", statuses: ["waiting_artwork"], dropStatus: "waiting_artwork", department: "front" },
  { key: "design", title: "Design", statuses: ["design"], dropStatus: "design", department: "design" },
  { key: "proof", title: "Proof Approval", statuses: ["proof_ready", "waiting_approval"], dropStatus: "waiting_approval", department: "design" },
  { key: "ready_prod", title: "Ready for Production", statuses: ["approved_for_production"], dropStatus: "approved_for_production", department: "production" },
  { key: "printing", title: "Printing", statuses: ["production"], dropStatus: "production", department: "production" },
  { key: "finishing", title: "Finishing", statuses: ["finishing", "quality_check"], dropStatus: "finishing", department: "production" },
  { key: "install", title: "Installation", statuses: ["scheduled_install"], dropStatus: "scheduled_install", department: "install" },
  { key: "ready", title: "Ready", statuses: ["ready_pickup", "scheduled_delivery"], dropStatus: "ready_pickup", department: "front" },
  { key: "complete", title: "Complete", statuses: ["completed"], dropStatus: "completed", department: "done" },
];

export function columnForStatus(status: JobStatus): BoardColumn | undefined {
  return BOARD_COLUMNS.find((c) => c.statuses.includes(status));
}

// ---------------------------------------------------------------------------
// Next step logic — the job adapts to what it needs.
// ---------------------------------------------------------------------------
export type WorkflowJob = {
  status: JobStatus;
  needsDesign: boolean;
  needsProof: boolean;
  needsInstall: boolean;
  fulfillment: Fulfillment;
  hasArtwork?: boolean;
};

/** Where a job goes after quality check. */
export function readyStatusFor(job: Pick<WorkflowJob, "needsInstall" | "fulfillment">): JobStatus {
  if (job.needsInstall || job.fulfillment === "install") return "scheduled_install";
  if (job.fulfillment === "delivery" || job.fulfillment === "ship") return "scheduled_delivery";
  return "ready_pickup";
}

/**
 * The first status after approval, skipping steps the job does not need.
 * "Design" also covers prepress: it's where proofs are made from customer artwork.
 */
export function afterApproval(job: WorkflowJob): JobStatus {
  if (job.hasArtwork === false && !job.needsDesign) return "waiting_artwork";
  if (job.needsDesign || job.needsProof) return "design";
  return "approved_for_production";
}

/**
 * The single most likely next status, used by the one-click "Next Step" button.
 * Returns null when there is no obvious next step (completed, cancelled, on hold).
 */
export function nextStatus(job: WorkflowJob): JobStatus | null {
  switch (job.status) {
    case "new":
    case "needs_quote":
    case "quote_sent":
      return "approved";
    case "approved":
      return afterApproval(job);
    case "waiting_artwork":
      return job.needsDesign || job.needsProof ? "design" : "approved_for_production";
    case "design":
      return job.needsProof ? "proof_ready" : "approved_for_production";
    case "proof_ready":
      return "waiting_approval";
    case "waiting_approval":
      return "approved_for_production";
    case "approved_for_production":
      return "production";
    case "production":
      return "finishing";
    case "finishing":
      return "quality_check";
    case "quality_check":
      return readyStatusFor(job);
    case "ready_pickup":
    case "scheduled_delivery":
    case "scheduled_install":
      return "completed";
    default:
      return null;
  }
}

/** Button label for the Next Step action. */
export function nextStepLabel(job: WorkflowJob): string | null {
  const next = nextStatus(job);
  if (!next) return null;
  switch (job.status) {
    case "proof_ready":
      return "Mark proof sent";
    case "waiting_approval":
      return "Customer approved proof";
    case "approved_for_production":
      return "Start production";
    case "production":
      return "Printing done → Finishing";
    case "finishing":
      return "Ready for quality check";
    case "quality_check":
      return `QC passed → ${STATUS_SHORT[next]}`;
    case "ready_pickup":
      return "Picked up — complete";
    case "scheduled_delivery":
      return "Delivered — complete";
    case "scheduled_install":
      return "Installed — complete";
    default:
      return `Move to ${STATUS_LABELS[next]}`;
  }
}
