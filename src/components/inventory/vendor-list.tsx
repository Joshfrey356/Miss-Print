"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VendorDialog, type VendorInfo } from "./vendor-dialog";

export function AddVendorButton() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add vendor
      </Button>
      <VendorDialog open={open} onOpenChange={setOpen} onSaved={() => router.refresh()} />
    </>
  );
}

export function EditVendorButton({ vendor }: { vendor: VendorInfo }) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Edit ${vendor.name}`}>
        <Pencil className="size-4" /> Edit
      </Button>
      {open && <VendorDialog open onOpenChange={setOpen} vendor={vendor} onSaved={() => router.refresh()} />}
    </>
  );
}
