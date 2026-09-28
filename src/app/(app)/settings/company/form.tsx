"use client";
import * as React from "react";
import { Logo, type LogoBrand } from "@/components/logo";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Confirm } from "@/components/ui/confirm";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useServerAction } from "@/components/use-action";
import type { CompanyProfile } from "@/lib/settings";
import { ActionForm, SaveButton } from "../_components/action-form";
import { removeCompanyLogo, saveCompanyProfile, uploadCompanyLogo } from "../actions";

/** White-label logo: shown in the sidebar, on the sign-in page, proof pages and as the browser icon. */
export function LogoForm({ brand }: { brand: LogoBrand }) {
  const [preview, setPreview] = React.useState<string | null>(null);
  const [removing, run] = useServerAction();
  React.useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  return (
    <ActionForm action={uploadCompanyLogo} resetOnSuccess onSuccess={() => setPreview(null)}>
      <Card>
        <CardHeader title="Logo" />
        <CardBody className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
          <div className="flex min-h-24 items-center rounded-xl border border-dashed border-slate-300 bg-white px-5 py-4">
            <Logo brand={{ ...brand, logoUrl: preview ?? brand.logoUrl }} />
          </div>
          <div className="space-y-2">
            <Field label="Upload a logo" htmlFor="logo" hint="PNG, JPG, WebP, GIF or SVG, up to 2 MB. A wide logo on a transparent background looks best. Without a logo, your company name is shown instead.">
              <input
                id="logo"
                name="logo"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                required
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  setPreview(f ? URL.createObjectURL(f) : null);
                }}
                className="block w-full text-[15px] text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:font-medium file:text-slate-800 hover:file:bg-slate-200"
              />
            </Field>
          </div>
        </CardBody>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          {brand.logoUrl && (
            <Confirm title="Remove the logo?" description="Your company name will be shown instead. You can upload a logo again any time." confirmLabel="Remove logo" onConfirm={() => run(removeCompanyLogo)}>
              <button type="button" disabled={removing} className="rounded-lg px-3 py-2 text-[15px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                Remove logo
              </button>
            </Confirm>
          )}
          <SaveButton pendingText="Uploading…">Save logo</SaveButton>
        </div>
      </Card>
    </ActionForm>
  );
}

export function CompanyForm({ company, jobPrefix }: { company: CompanyProfile; jobPrefix: string }) {
  return (
    <ActionForm action={saveCompanyProfile}>
      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" htmlFor="name" required hint="Shown everywhere in place of a logo, and as the sender name on customer emails.">
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
          <Field label="Job number prefix" htmlFor="jobPrefix" required hint={`Shown before job numbers, e.g. ${jobPrefix}-10428. 1–5 letters. Changing it only changes the letters shown — job numbers stay the same.`}>
            <Input id="jobPrefix" name="jobPrefix" defaultValue={jobPrefix} required maxLength={5} pattern="[A-Za-z]{1,5}" title="1–5 letters" autoComplete="off" className="uppercase" />
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
