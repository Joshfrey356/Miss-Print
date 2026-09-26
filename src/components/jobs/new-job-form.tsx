"use client";
import { useActionState, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, MoneyInput, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { CustomerPicker, type PickedCustomer } from "@/components/customer-picker";
import { createJob } from "@/app/(app)/jobs/actions";
import { FULFILLMENT_LABELS, PRIORITY_LABELS } from "@/lib/jobs/workflow";
import type { Role } from "@/lib/db/schema";

type Cat = { id: number; name: string; defaultNeedsProof: boolean; defaultNeedsInstall: boolean; defaultLocationId: number | null };
type Person = { id: number; name: string; role: Role };
type Opt = { id: number; name: string };

export function NewJobForm({ initialCustomer, categories, people, locations, canSeeMoney, currentUserId }: { initialCustomer: PickedCustomer | null; categories: Cat[]; people: Person[]; locations: Opt[]; canSeeMoney: boolean; currentUserId: number }) {
  const [state, action] = useActionState(createJob, undefined);
  const [customer, setCustomer] = useState(initialCustomer);
  const [catId, setCatId] = useState<number | null>(null);
  const cat = categories.find((c) => c.id === catId);
  const [needsProof, setNeedsProof] = useState(true);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [locationId, setLocationId] = useState<number | "">("");
  const byRole = (roles: Role[]) => people.filter((p) => roles.includes(p.role));

  return (
    <form action={action} className="mx-auto max-w-3xl space-y-5">
      <input type="hidden" name="customerId" value={customer?.id ?? ""} />
      <Card>
        <CardHeader title="Customer" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <CustomerPicker value={customer} onChange={setCustomer} autoFocus={!initialCustomer} />
          </div>
          {customer && customer.contacts.length > 0 && (
            <Field label="Contact">
              <Select name="contactId" defaultValue={customer.contacts.find((c) => c.isPrimary)?.id ?? ""}>
                <option value="">—</option>
                {customer.contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {customer?.poRequired && (
            <Field label="PO number" hint="This customer requires a PO on invoices">
              <Input name="poNumber" />
            </Field>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="The job" description="Tip: if pricing isn't settled yet, create a quote instead." />
        <CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Job title" className="col-span-2 sm:col-span-4" required hint="e.g. “500 Tri-Fold Brochures” or “ABC Plumbing Ford Transit Wrap”">
            <Input name="title" required />
          </Field>
          <Field label="Category" className="col-span-2">
            <Select
              name="categoryId"
              value={catId ?? ""}
              onChange={(e) => {
                const id = e.target.value ? Number(e.target.value) : null;
                setCatId(id);
                const c = categories.find((x) => x.id === id);
                if (c) {
                  setNeedsProof(c.defaultNeedsProof);
                  setNeedsInstall(c.defaultNeedsInstall);
                  if (c.defaultLocationId) setLocationId(c.defaultLocationId);
                }
              }}
            >
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quantity">
            <Input name="quantity" type="number" min="1" defaultValue={1} />
          </Field>
          <Field label="Priority">
            <Select name="priority" defaultValue="normal">
              {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Width (in)">
            <Input name="widthIn" type="number" step="0.01" />
          </Field>
          <Field label="Height (in)">
            <Input name="heightIn" type="number" step="0.01" />
          </Field>
          <Field label="Material" className="col-span-2">
            <Input name="material" />
          </Field>
          <Field label="Finishing" className="col-span-2">
            <Input name="finishing" />
          </Field>
          <Field label="Due date" className="col-span-1">
            <Input name="dueDate" type="date" />
          </Field>
          {canSeeMoney && (
            <Field label="Price" className="col-span-1">
              <MoneyInput name="price" />
            </Field>
          )}
          <Field label="Specifications / description" className="col-span-2 sm:col-span-4">
            <Textarea name="specs" rows={3} placeholder={cat ? `Details for ${cat.name.toLowerCase()}…` : "Stock, colors, bleed, vehicle info…"} />
          </Field>
          <div className="col-span-2 flex flex-wrap gap-x-6 gap-y-3 sm:col-span-4">
            <Checkbox name="hasArtwork" label="We already have print-ready artwork" hint="Repeat jobs & customer-supplied files" />
            <Checkbox name="needsDesign" label="Needs design" />
            <Checkbox name="needsProof" label="Needs proof approval" checked={needsProof} onChange={(e) => setNeedsProof(e.target.checked)} />
            <Checkbox name="needsInstall" label="Needs installation" checked={needsInstall} onChange={(e) => setNeedsInstall(e.target.checked)} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Who & where" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Location">
            <Select name="locationId" value={locationId} onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">—</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="How it goes out">
            <Select name="fulfillment" defaultValue={needsInstall ? "install" : "pickup"} key={String(needsInstall)}>
              {Object.entries(FULFILLMENT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Salesperson">
            <Select name="salespersonId" defaultValue={customer?.salespersonId ?? currentUserId} key={customer?.id ?? 0}>
              {byRole(["owner", "manager", "sales"]).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Designer">
            <Select name="designerId" defaultValue="">
              <option value="">Unassigned</option>
              {byRole(["designer", "owner", "manager"]).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Production">
            <Select name="productionId" defaultValue="">
              <option value="">Unassigned</option>
              {byRole(["production", "manager", "owner"]).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          {needsInstall && (
            <>
              <Field label="Installer">
                <Select name="installerId" defaultValue="">
                  <option value="">Unassigned</option>
                  {byRole(["installer", "production", "manager"]).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Install address" className="sm:col-span-2">
                <Input name="siteAddress" />
              </Field>
            </>
          )}
          <Field label="Internal notes" className="sm:col-span-2">
            <Textarea name="internalNotes" rows={2} />
          </Field>
        </CardBody>
      </Card>

      {state && !state.ok && <p className="rounded-lg bg-red-50 px-4 py-3 text-[15px] text-red-700">{state.error}</p>}
      <div className="flex justify-end">
        <SubmitButton size="lg" pendingText="Creating…">
          Create job
        </SubmitButton>
      </div>
    </form>
  );
}
