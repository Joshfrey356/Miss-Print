"use client";
import * as React from "react";
import { Dialog, DialogContent, DialogClose } from "./dialog";
import { Button } from "./button";

/**
 * Wrap a dangerous action: shows a confirmation dialog before running onConfirm.
 * Usage: <Confirm title="Void invoice?" onConfirm={...}><Button>Void</Button></Confirm>
 */
export function Confirm({
  title,
  description,
  confirmLabel = "Yes, continue",
  danger = true,
  onConfirm,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  children: React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  return (
    <>
      {React.cloneElement(children, {
        onClick: (e: React.MouseEvent) => {
          e.preventDefault();
          setOpen(true);
        },
      })}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={title} description={description}>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button
              variant={danger ? "danger" : "primary"}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
