"use client";
import { Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AUTO_EVENT, NEW_BLOCK_EVENT } from "./schedule-board";

/** Toolbar buttons that open the board's dialogs. */
export function ScheduleToolbarButtons({ waitingCount }: { waitingCount: number }) {
  return (
    <>
      <Button onClick={() => window.dispatchEvent(new Event(NEW_BLOCK_EVENT))} title="Maintenance, a service visit or anything else that keeps a machine busy">
        <Plus className="size-4" /> Block off time
      </Button>
      {waitingCount > 0 && (
        <Button variant="primary" onClick={() => window.dispatchEvent(new Event(AUTO_EVENT))}>
          <Sparkles className="size-4" /> Auto-schedule {waitingCount} waiting
        </Button>
      )}
    </>
  );
}
