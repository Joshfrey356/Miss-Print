"use client";
import * as React from "react";
import { blockIssues, type BusyBlock, type Issue } from "@/lib/schedule/logic";
import type { BoardBlock, BoardMachine, BoardPiece, ScheduleView, WaitingJob } from "@/lib/schedule/types";

export type Person = { id: number; name: string };

/** Where a drag would land right now (shown as a dashed outline). */
export type DropPreview = { equipmentId: number; start: number; end: number; ymd?: string } | null;

/** What's being dragged. */
export type DragData = { type: "block"; block: BoardBlock } | { type: "piece"; piece: BoardPiece; job: WaitingJob };

export type BoardCtx = {
  view: ScheduleView;
  date: string;
  days: string[];
  machines: BoardMachine[];
  machineById: Map<number, BoardMachine>;
  blocks: BoardBlock[];
  /** Every booking from now on (for "first free time" suggestions), not just the ones shown. */
  busy: BusyBlock[];
  waiting: WaitingJob[];
  users: Person[];
  canEdit: boolean;
  highlightJobId: number | null;
  now: number;
  preview: DropPreview;
  /** Pieces booked a moment ago (hidden until the server's fresh list arrives). */
  hiddenPieces: Set<string>;
  issuesOf: (b: BoardBlock) => Issue[];
  openBlock: (b: BoardBlock) => void;
  openPiece: (job: WaitingJob, piece: BoardPiece) => void;
  schedulePiece: (job: WaitingJob, piece: BoardPiece, at?: { equipmentId?: number; start?: number; minutes?: number }) => void;
  newBlock: (at?: { equipmentId?: number; start?: number }) => void;
  pending: boolean;
  /** Day view geometry, written by the grid and read when a drag ends. */
  geometry: React.RefObject<{ viewStart: number; ppm: number }>;
  /** Change a booking's length (day view resize). */
  resizeBlock: (b: BoardBlock, end: number) => void;
};

const Ctx = React.createContext<BoardCtx | null>(null);
export const BoardProvider = Ctx.Provider;
export function useBoard() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useBoard outside the schedule board");
  return c;
}

export const pieceId = (jobId: number, key: string) => `${jobId}|${key}`;

/** Issues of every booking, worked out once per change. */
export function useIssues(blocks: BoardBlock[], machineById: Map<number, BoardMachine>) {
  return React.useMemo(() => {
    const map = new Map<number, Issue[]>();
    for (const b of blocks) map.set(b.id, blockIssues({ ...b, dueDate: b.job?.dueDate ?? null }, machineById.get(b.equipmentId), blocks));
    return map;
  }, [blocks, machineById]);
}
