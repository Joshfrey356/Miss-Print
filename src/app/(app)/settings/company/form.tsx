"use client";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import type { CompanyProfile } from "@/lib/settings";
import { ActionForm, SaveButton } from "../_components/action-form";
import { saveCompanyProfile } from "../actions";

export function CompanyForm({ company }: { company: CompanyProfile }) {
  return (
    <ActionForm action={saveCompanyProfile}>
      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" htmlFor="name" required>
            <Input id="name" name="name" defaultValue={company.name} required />
          </Field>
          <Field label="Tagline" htmlFor="tagline">
            <Input id="tagline" name="tagline" defaultValue={company.tagline} />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={company.phone} />
          </Field>
          <Field label="Email customers write to" htmlFor="email">
            <Input id="email" name="email" type="email" defaultValue={company.email} />
          </Field>
          <Field label="Website" htmlFor="website" className="sm:col-span-2">
            <Input id="website" name="website" defaultValue={company.website} />
          </Field>
          <Field label="Main address" htmlFor="address" className="sm:col-span-2">
            <Input id="address" name="address" defaultValue={company.address} />
          </Field>
          <Field label="Hours" htmlFor="hours" hint="Shown to customers, e.g. on the proof approval page." className="sm:col-span-2">
            <Textarea id="hours" name="hours" rows={2} defaultValue={company.hours} />
          </Field>
        </CardBody>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <SaveButton pendingText="Saving…">Save company profile</SaveButton>
        </div>
      </Card>
    </ActionForm>
  );
}
