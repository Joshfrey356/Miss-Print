"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { saveVendorAction } from "@/app/(app)/inventory/actions";
import { StockForm, StockSubmit } from "./stock-form";

export type VendorInfo = {
  id: number;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  accountNumber: string | null;
  website: string | null;
  notes: string | null;
};

/** Add or edit a vendor. `onSaved` gets the id and name (to pick it in a form). */
export function VendorDialog({ open, onOpenChange, vendor, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; vendor?: VendorInfo | null; onSaved?: (v: { id: number; name: string; email: string | null }) => void }) {
  const emailRef = React.useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide title={vendor ? `Edit ${vendor.name}` : "Add a vendor"} description="Who you buy from. The email is where purchase orders are sent.">
        <StockForm
          action={saveVendorAction}
          successMessage={vendor ? "Vendor saved" : "Vendor added"}
          resetOnSuccess={!vendor}
          onSuccess={(r) => {
            const d = r.data as { id: number; name: string };
            onSaved?.({ ...d, email: emailRef.current?.value.trim() || null });
            onOpenChange(false);
          }}
        >
          {vendor && <input type="hidden" name="id" value={vendor.id} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="v-name" required>
              <Input id="v-name" name="name" required defaultValue={vendor?.name} placeholder="e.g. Veritiv" />
            </Field>
            <Field label="Contact person" htmlFor="v-contact">
              <Input id="v-contact" name="contactName" defaultValue={vendor?.contactName ?? ""} placeholder="e.g. Sam (inside sales)" />
            </Field>
            <Field label="Email for orders" htmlFor="v-email">
              <Input id="v-email" ref={emailRef} name="email" type="email" defaultValue={vendor?.email ?? ""} placeholder="orders@vendor.com" />
            </Field>
            <Field label="Phone" htmlFor="v-phone">
              <Input id="v-phone" name="phone" type="tel" defaultValue={vendor?.phone ?? ""} />
            </Field>
            <Field label="Our account #" htmlFor="v-acct" hint="Printed on purchase orders.">
              <Input id="v-acct" name="accountNumber" defaultValue={vendor?.accountNumber ?? ""} />
            </Field>
            <Field label="Website" htmlFor="v-web">
              <Input id="v-web" name="website" defaultValue={vendor?.website ?? ""} placeholder="https://" />
            </Field>
            <Field label="Notes" htmlFor="v-notes" className="sm:col-span-2">
              <Textarea id="v-notes" name="notes" rows={2} defaultValue={vendor?.notes ?? ""} placeholder="Delivery days, minimum order, rep's cell…" />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <StockSubmit>{vendor ? "Save vendor" : "Add vendor"}</StockSubmit>
          </div>
        </StockForm>
      </DialogContent>
    </Dialog>
  );
}
