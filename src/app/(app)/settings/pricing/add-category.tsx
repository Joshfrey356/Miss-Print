"use client";
import * as React from "react";
import { Plus } from "lucide-react";
import { GROUP_LABELS, PRICING_METHOD_HINTS, PRICING_METHOD_LABELS } from "@/lib/admin/pricing-labels";
import type { PricingMethod } from "@/lib/pricing/engine";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { ActionForm, SaveButton } from "../_components/action-form";
import { createCategory } from "./actions";

export function AddCategoryButton() {
  const [open, setOpen] = React.useState(false);
  const [method, setMethod] = React.useState<PricingMethod>("per_sqft");
  return (
    <>
      <Button variant="primary" size="lg" onClick={() => setOpen(true)}>
        <Plus className="size-5" /> Add category
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Add a product category" description="You'll set up the prices on the next screen.">
          <ActionForm action={createCategory} className="space-y-4">
            <Field label="Name" htmlFor="cat-name" required>
              <Input id="cat-name" name="name" required placeholder="e.g. Window Perf" />
            </Field>
            <Field label="Group" htmlFor="cat-group" required>
              <Select id="cat-group" name="group" defaultValue="sign">
                {Object.entries(GROUP_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="How is it priced?" htmlFor="cat-method" hint={PRICING_METHOD_HINTS[method]} required>
              <Select id="cat-method" name="method" value={method} onChange={(e) => setMethod(e.target.value as PricingMethod)}>
                {Object.entries(PRICING_METHOD_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <SaveButton pendingText="Adding…">Add and set up prices</SaveButton>
            </div>
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}
