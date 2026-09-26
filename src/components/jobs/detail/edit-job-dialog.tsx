"use client";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { useServerAction } from "@/components/use-action";
import { updateJob } from "@/app/(app)/jobs/actions";
import { FULFILLMENT_LABELS, PRIORITY_LABELS } from "@/lib/jobs/workflow";
import type { Job } from "@/lib/db/schema";

type Opt = { id: number; name: string };

/** datetime-local value in shop time */
function toLocalInput(d: Date | string | null) {
  if (!d) return "";
  const s = new Date(d).toLocaleString("sv-SE", { timeZone: "America/Chicago" }); // "2026-09-28 09:00:00"
  return s.slice(0, 16).replace(" ", "T");
}

export function EditJobDialog({ job, categories, locations, contacts, canSeeCost }: { job: Job; categories: Opt[]; locations: Opt[]; contacts: Opt[]; canSeeCost: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, run] = useServerAction();
  const [fulfillment, setFulfillment] = useState(job.fulfillment);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Pencil className="size-4" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent title="Edit job details" wide>
        <form
          action={(fd) => run(() => updateJob(job.id, fd), { onSuccess: () => setOpen(false) })}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <Field label="Job title" className="sm:col-span-2" required>
            <Input name="title" defaultValue={job.title} required />
          </Field>
          <Field label="Category">
            <Select name="categoryId" defaultValue={job.categoryId ?? ""}>
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Customer contact">
            <Select name="contactId" defaultValue={job.contactId ?? ""}>
              <option value="">—</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority">
            <Select name="priority" defaultValue={job.priority}>
              {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Location (who has the next step)">
            <Select name="locationId" defaultValue={job.locationId ?? ""}>
              <option value="">—</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date (customer)">
            <Input type="date" name="dueDate" defaultValue={job.dueDate ?? ""} />
          </Field>
          <Field label="Production due">
            <Input type="date" name="productionDueDate" defaultValue={job.productionDueDate ?? ""} />
          </Field>
          <Field label="How it goes out">
            <Select name="fulfillment" value={fulfillment} onChange={(e) => setFulfillment(e.target.value as Job["fulfillment"])}>
              {Object.entries(FULFILLMENT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={fulfillment === "install" ? "Install date & time" : fulfillment === "delivery" ? "Delivery date & time" : "Pickup date & time"} hint="Shows on the calendar">
            <Input type="datetime-local" name="fulfillmentAt" defaultValue={toLocalInput(job.fulfillmentAt)} />
          </Field>
          {(fulfillment === "install" || fulfillment === "delivery") && (
            <>
              <Field label="Site address" className="sm:col-span-2">
                <Input name="siteAddress" defaultValue={job.siteAddress ?? ""} placeholder="Street, city" />
              </Field>
              <Field label="Site contact" className="sm:col-span-2">
                <Input name="siteContact" defaultValue={job.siteContact ?? ""} placeholder="Name & phone of the person on site" />
              </Field>
            </>
          )}
          <Field label="Customer PO #">
            <Input name="poNumber" defaultValue={job.poNumber ?? ""} />
          </Field>
          {canSeeCost ? (
            <Field label="In-house labor hours" hint="Used for actual job profit">
              <Input name="laborHours" type="number" step="0.25" min="0" defaultValue={job.laborHours ?? 0} />
            </Field>
          ) : (
            <input type="hidden" name="laborHours" value={job.laborHours ?? 0} />
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-2 sm:col-span-2">
            <Checkbox name="needsDesign" label="Needs design" defaultChecked={job.needsDesign} />
            <Checkbox name="needsProof" label="Needs proof approval" defaultChecked={job.needsProof} />
            <Checkbox name="needsInstall" label="Needs installation" defaultChecked={job.needsInstall} />
          </div>
          <Field label="Description" className="sm:col-span-2">
            <Textarea name="description" defaultValue={job.description ?? ""} rows={3} />
          </Field>
          <Field label="Internal notes (staff only)" className="sm:col-span-2">
            <Textarea name="internalNotes" defaultValue={job.internalNotes ?? ""} rows={3} />
          </Field>
          <Field label="Customer-visible notes" className="sm:col-span-2" hint="May appear on proofs, invoices and the future customer portal">
            <Textarea name="customerNotes" defaultValue={job.customerNotes ?? ""} rows={2} />
          </Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
