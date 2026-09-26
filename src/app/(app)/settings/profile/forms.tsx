"use client";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/input";
import { ActionForm, SaveButton } from "../_components/action-form";
import { changeMyPassword, saveMyNotifications, saveMyProfile } from "./actions";

export function ProfileForm({ name, phone, handle }: { name: string; phone: string; handle: string }) {
  return (
    <ActionForm action={saveMyProfile}>
      <Card>
        <CardHeader title="About me" description={<>People mention you in messages as <b>@{handle}</b>.</>} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="My name" htmlFor="name" required>
            <Input id="name" name="name" defaultValue={name} required autoComplete="name" />
          </Field>
          <Field label="My phone" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={phone} autoComplete="tel" />
          </Field>
        </CardBody>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <SaveButton pendingText="Saving…">Save</SaveButton>
        </div>
      </Card>
    </ActionForm>
  );
}

export function NotificationsForm({ kinds }: { kinds: { key: string; label: string; on: boolean }[] }) {
  return (
    <ActionForm action={saveMyNotifications}>
      <Card>
        <CardHeader title="Notify me when…" description="Notifications show up under the bell at the top of the screen." />
        <CardBody className="space-y-3.5">
          {kinds.map((k) => (
            <Checkbox key={k.key} name={k.key} defaultChecked={k.on} label={k.label} />
          ))}
        </CardBody>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <SaveButton pendingText="Saving…">Save notification settings</SaveButton>
        </div>
      </Card>
    </ActionForm>
  );
}

export function PasswordForm() {
  return (
    <ActionForm action={changeMyPassword} resetOnSuccess successMessage="Password changed">
      <Card>
        <CardHeader title="Change my password" description="At least 10 characters. A short sentence is easy to remember and hard to guess." />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Current password" htmlFor="current" required>
            <Input id="current" name="current" type="password" autoComplete="current-password" required />
          </Field>
          <Field label="New password" htmlFor="next" required>
            <Input id="next" name="next" type="password" autoComplete="new-password" minLength={10} required />
          </Field>
          <Field label="New password again" htmlFor="confirm" required>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
          </Field>
        </CardBody>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <SaveButton pendingText="Changing…">Change password</SaveButton>
        </div>
      </Card>
    </ActionForm>
  );
}
