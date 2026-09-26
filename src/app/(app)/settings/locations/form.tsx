"use client";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/input";
import { ActionForm, SaveButton } from "../_components/action-form";
import { addLocation, saveLocation } from "../actions";

type Loc = { id: number; code: string; name: string; role: string; address: string | null; phone: string | null; isCustomerFacing: boolean };

export function LocationForm({ location: l }: { location: Loc }) {
  return (
    <ActionForm action={saveLocation}>
      <Card>
        <CardHeader
          title={l.name}
          action={l.isCustomerFacing ? <Badge tone="blue">Customers come here</Badge> : <Badge>Not a retail counter</Badge>}
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="id" value={l.id} />
          <Field label="Name" htmlFor={`name-${l.id}`} required>
            <Input id={`name-${l.id}`} name="name" defaultValue={l.name} required />
          </Field>
          <Field label="Phone" htmlFor={`phone-${l.id}`}>
            <Input id={`phone-${l.id}`} name="phone" type="tel" defaultValue={l.phone ?? ""} />
          </Field>
          <Field label="What happens here" htmlFor={`role-${l.id}`} className="sm:col-span-2">
            <Input id={`role-${l.id}`} name="role" defaultValue={l.role} placeholder="e.g. Production · signs · large format" />
          </Field>
          <Field label="Address" htmlFor={`address-${l.id}`} className="sm:col-span-2">
            <Input id={`address-${l.id}`} name="address" defaultValue={l.address ?? ""} />
          </Field>
        </CardBody>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <SaveButton pendingText="Saving…">Save {l.name}</SaveButton>
        </div>
      </Card>
    </ActionForm>
  );
}

export function AddLocationForm() {
  return (
    <ActionForm action={addLocation} resetOnSuccess>
      <Card>
        <CardHeader title="Add a location" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name-new" required>
            <Input id="name-new" name="name" required placeholder="e.g. Production shop" />
          </Field>
          <Field label="Phone" htmlFor="phone-new">
            <Input id="phone-new" name="phone" type="tel" />
          </Field>
          <Field label="What happens here" htmlFor="role-new" className="sm:col-span-2">
            <Input id="role-new" name="role" placeholder="e.g. Production · signs · large format" />
          </Field>
          <Field label="Address" htmlFor="address-new" className="sm:col-span-2">
            <Input id="address-new" name="address" />
          </Field>
          <Checkbox name="isCustomerFacing" label="Customers come here (front counter)" className="sm:col-span-2" />
        </CardBody>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <SaveButton pendingText="Adding…">Add location</SaveButton>
        </div>
      </Card>
    </ActionForm>
  );
}
