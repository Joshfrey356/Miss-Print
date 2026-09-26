"use client";
import * as React from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import type { Role } from "@/lib/db/schema";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { Field, Input, Select } from "@/components/ui/input";
import { useServerAction } from "@/components/use-action";
import { ActionForm, SaveButton } from "../_components/action-form";
import { createUser, resetUserPassword, setUserActive, updateUser } from "./actions";

type Loc = { id: number; name: string };
type EditableUser = {
  id: number;
  name: string;
  handle: string;
  email: string;
  role: Role;
  title: string | null;
  phone: string | null;
  locationId: number | null;
  active: boolean;
};

function UserFields({ user, locations, lockRole }: { user?: EditableUser; locations: Loc[]; lockRole?: boolean }) {
  const [role, setRole] = React.useState<Role>(user?.role ?? "sales");
  const [handle, setHandle] = React.useState(user?.handle ?? "");
  const [touchedHandle, setTouchedHandle] = React.useState(Boolean(user));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" htmlFor="u-name" required>
        <Input
          id="u-name"
          name="name"
          defaultValue={user?.name}
          required
          onChange={(e) => {
            if (!touchedHandle) setHandle((e.target.value.split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z0-9._-]/g, ""));
          }}
        />
      </Field>
      <Field label="@mention name" htmlFor="u-handle" hint="Used in messages, e.g. @mike" required>
        <Input
          id="u-handle"
          name="handle"
          value={handle}
          required
          onChange={(e) => {
            setTouchedHandle(true);
            setHandle(e.target.value.toLowerCase());
          }}
        />
      </Field>
      <Field label="Email (used to sign in)" htmlFor="u-email" required className="sm:col-span-2">
        <Input id="u-email" name="email" type="email" defaultValue={user?.email} required autoComplete="off" />
      </Field>
      <Field label="Role" htmlFor="u-role" required hint={lockRole ? "You can't change your own role." : ROLE_DESCRIPTIONS[role]} className="sm:col-span-2">
        <Select id="u-role" name="role" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={lockRole}>
          {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
        {lockRole && <input type="hidden" name="role" value={role} />}
      </Field>
      <Field label="Job title" htmlFor="u-title">
        <Input id="u-title" name="title" defaultValue={user?.title ?? ""} placeholder="e.g. Lead installer" />
      </Field>
      <Field label="Location" htmlFor="u-loc">
        <Select id="u-loc" name="locationId" defaultValue={user?.locationId ?? ""}>
          <option value="">—</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Phone" htmlFor="u-phone">
        <Input id="u-phone" name="phone" type="tel" defaultValue={user?.phone ?? ""} />
      </Field>
    </div>
  );
}

export function AddUserButton({ locations }: { locations: Loc[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="primary" size="lg" onClick={() => setOpen(true)}>
        <Plus className="size-5" /> Add person
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent wide title="Add a team member" description="They sign in with this email and the temporary password you give them.">
          <ActionForm action={createUser} onSuccess={() => setOpen(false)}>
            <UserFields locations={locations} />
            <div className="mt-4">
              <Field label="Temporary password" htmlFor="u-pass" required hint="At least 10 characters. Tell them in person; they can change it under My Profile.">
                <Input id="u-pass" name="password" type="text" minLength={10} required autoComplete="new-password" />
              </Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <SaveButton pendingText="Adding…">Add person</SaveButton>
            </div>
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function UserActions({ user, isMe, locations }: { user: EditableUser; isMe: boolean; locations: Loc[] }) {
  const [dialog, setDialog] = React.useState<"edit" | "password" | "deactivate" | null>(null);
  const [pending, run] = useServerAction();
  return (
    <>
      <Dropdown>
        <DropdownTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`Options for ${user.name}`} disabled={pending}>
            <MoreHorizontal className="size-5" />
          </Button>
        </DropdownTrigger>
        <DropdownContent>
          <DropdownItem onSelect={() => setDialog("edit")}>Edit details</DropdownItem>
          <DropdownItem onSelect={() => setDialog("password")}>Reset password</DropdownItem>
          {!isMe && <DropdownSeparator />}
          {!isMe &&
            (user.active ? (
              <DropdownItem onSelect={() => setDialog("deactivate")} className="text-red-700">
                Deactivate…
              </DropdownItem>
            ) : (
              <DropdownItem onSelect={() => run(() => setUserActive(user.id, true))}>Reactivate</DropdownItem>
            ))}
        </DropdownContent>
      </Dropdown>

      <Dialog open={dialog === "edit"} onOpenChange={(o) => setDialog(o ? "edit" : null)}>
        <DialogContent wide title={`Edit ${user.name}`}>
          <ActionForm action={updateUser} onSuccess={() => setDialog(null)} className="text-left">
            <input type="hidden" name="id" value={user.id} />
            <UserFields user={user} locations={locations} lockRole={isMe} />
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setDialog(null)}>Cancel</Button>
              <SaveButton>Save</SaveButton>
            </div>
          </ActionForm>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "deactivate"} onOpenChange={(o) => setDialog(o ? "deactivate" : null)}>
        <DialogContent
          title={`Deactivate ${user.name}?`}
          description="They'll be signed out right away and can't sign in again. Their jobs, messages and history stay. You can reactivate them later."
        >
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => run(() => setUserActive(user.id, false), { onSuccess: () => setDialog(null) })}
            >
              Deactivate
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "password"} onOpenChange={(o) => setDialog(o ? "password" : null)}>
        <DialogContent
          title={`Reset password for ${user.name}`}
          description={isMe ? "Sets a new password for your account." : "They'll be signed out everywhere and must sign in with the new password."}
        >
          <ActionForm action={resetUserPassword} onSuccess={() => setDialog(null)} className="text-left">
            <input type="hidden" name="id" value={user.id} />
            <Field label="New password" htmlFor={`pw-${user.id}`} hint="At least 10 characters." required>
              <Input id={`pw-${user.id}`} name="password" type="text" minLength={10} required autoComplete="new-password" />
            </Field>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setDialog(null)}>Cancel</Button>
              <SaveButton pendingText="Resetting…">Reset password</SaveButton>
            </div>
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}
