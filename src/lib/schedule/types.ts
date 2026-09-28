/**
 * What the schedule board, the job card and the TV get from the server. Pure (no "server-only"),
 * so client components can import the types and the small helpers.
 */
import type { JobStatus } from "@/lib/db/schema";
import type { BlockStatus, MachineKind, Priority, SchedMachine, WaitingPiece } from "./logic";

export type BoardMachine = SchedMachine & { sortOrder: number };

export type BoardJob = {
  id: number;
  number: number;
  title: string;
  customer: string;
  dueDate: string | null;
  priority: Priority;
  status: JobStatus;
};

export type BoardBlock = {
  id: number;
  equipmentId: number;
  start: number;
  end: number;
  status: BlockStatus;
  title: string;
  notes: string | null;
  operatorId: number | null;
  operatorName: string | null;
  jobItemId: number | null;
  quantity: number | null;
  job: BoardJob | null;
};

export type BoardPiece = WaitingPiece & { itemDescription: string; quantity: number };
export type WaitingJob = BoardJob & { pieces: BoardPiece[] };

export type ScheduleView = "day" | "week";

export const BLOCK_STATUS_LABELS: Record<BlockStatus, string> = { scheduled: "Scheduled", running: "Running", done: "Done" };

export const MACHINE_KIND_SHORT: Record<MachineKind, string> = {
  digital: "Digital",
  offset: "Offset",
  wide_format: "Wide format",
  cutter: "Cutter",
  folder: "Folder",
  bindery: "Bindery",
  other: "Other",
};

/** Kinds shown as rows on the board, in this order. */
export const KIND_ORDER: MachineKind[] = ["digital", "offset", "wide_format", "cutter", "folder", "bindery", "other"];

/** "Auto-schedule all waiting" preview. */
export type AutoProposal = {
  jobId: number;
  jobNumber: number;
  jobTitle: string;
  customer: string;
  dueDate: string | null;
  priority: "normal" | "rush" | "critical";
  key: string;
  label: string;
  itemDescription: string;
  equipmentId: number;
  machineName: string;
  minutes: number;
  segments: { start: number; end: number }[];
  late: boolean;
};
export type AutoPreview = { proposals: AutoProposal[]; skipped: { jobNumber: number; jobTitle: string; label: string; reason: string }[] };

