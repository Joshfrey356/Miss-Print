"use client";
import * as React from "react";
import Link from "next/link";
import { Pencil, Power, PowerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { useServerAction } from "@/components/use-action";

type Result = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Edit + turn off / turn back on, for one row of a catalog list (paper, presses, services).
 * Shared by Settings → Paper & Stock, Presses & Equipment and Bindery & Services.
 */
export function RowActions({
  name,
  active,
  onEdit,
  setActive,
  offWarning,
}: {
  name: string;
  active: boolean;
  onEdit: () => void;
  setActive: (active: boolean) => Promise<Result>;
  /** What turning it off means, in plain words. */
  offWarning: string;
}) {
  const [pending, run] = useServerAction();
  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${name}`}>
        <Pencil className="size-4" />
        <span className="hidden sm:inline">Edit</span>
      </Button>
      {active ? (
        <Confirm title={`Turn off ${name}?`} description={offWarning} confirmLabel="Turn off" onConfirm={() => run(() => setActive(false))}>
          <Button variant="ghost" size="sm" disabled={pending} aria-label={`Turn off ${name}`} title="Turn off">
            <PowerOff className="size-4 text-slate-500" />
          </Button>
        </Confirm>
      ) : (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setActive(true))} aria-label={`Turn ${name} back on`}>
          <Power className="size-4 text-emerald-600" />
          <span className="hidden sm:inline">Turn on</span>
        </Button>
      )}
    </div>
  );
}

/** "Show turned-off (2)" / "Hide turned-off" link that flips ?show=all. */
export function ShowInactiveLink({ showAll, inactiveCount, basePath }: { showAll: boolean; inactiveCount: number; basePath: string }) {
  if (!inactiveCount && !showAll) return null;
  return (
    <Link href={showAll ? basePath : `${basePath}?show=all`} className="text-sm font-medium text-brand-700 hover:underline">
      {showAll ? "Hide turned-off" : `Show turned-off (${inactiveCount})`}
    </Link>
  );
}
