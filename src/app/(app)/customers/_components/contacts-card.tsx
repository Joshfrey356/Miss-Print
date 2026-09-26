"use client";
import { useState, useTransition } from "react";
import { Loader2, Mail, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Confirm } from "@/components/ui/confirm";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/input";
import { archiveContact, saveContact } from "../actions";

export type ContactRow = {
  id: number;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isPrimary: boolean;
};

export function ContactsCard({ customerId, contacts, canEdit }: { customerId: number; contacts: ContactRow[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<ContactRow | "new" | null>(null);
  return (
    <Card>
      <CardHeader
        title="Contacts"
        action={
          canEdit && (
            <Button size="sm" variant="ghost" onClick={() => setEditing("new")}>
              <Plus className="size-3.5" />
              Add contact
            </Button>
          )
        }
      />
      {contacts.length === 0 ? (
        <p className="px-5 py-4 text-[15px] text-slate-500">No contacts saved for this customer.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {contacts.map((c) => (
            <li key={c.id} className="group px-5 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-slate-900">
                    {c.name}
                    {c.isPrimary && <Badge tone="blue">Main contact</Badge>}
                  </p>
                  {c.title && <p className="text-sm text-slate-500">{c.title}</p>}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-0.5">
                    <Button size="sm" variant="ghost" className="px-2" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Confirm
                      title={`Remove ${c.name}?`}
                      description="They'll be removed from this customer's contact list. Past jobs and quotes keep their history."
                      confirmLabel="Remove contact"
                      onConfirm={async () => {
                        const r = await archiveContact(customerId, c.id);
                        if (r.ok) toast.success("Contact removed");
                        else toast.error(r.error);
                      }}
                    >
                      <Button size="sm" variant="ghost" className="px-2 text-slate-500 hover:text-red-700" aria-label={`Remove ${c.name}`}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </Confirm>
                  </div>
                )}
              </div>
              <div className="mt-1 space-y-0.5 text-[15px]">
                {c.phone && (
                  <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-2 text-slate-700 hover:text-brand-700">
                    <Phone className="size-3.5 text-slate-400" />
                    {c.phone}
                  </a>
                )}
                {c.email && (
                  <a href={`mailto:${c.email}`} className="flex items-center gap-2 break-all text-slate-700 hover:text-brand-700">
                    <Mail className="size-3.5 shrink-0 text-slate-400" />
                    {c.email}
                  </a>
                )}
                {c.notes && <p className="text-sm text-slate-500">{c.notes}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing != null && (
          <ContactDialog
            customerId={customerId}
            contact={editing === "new" ? null : editing}
            firstContact={contacts.length === 0}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
    </Card>
  );
}

function ContactDialog({
  customerId,
  contact,
  firstContact,
  onDone,
}: {
  customerId: number;
  contact: ContactRow | null;
  firstContact: boolean;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <DialogContent title={contact ? `Edit ${contact.name}` : "Add a contact"}>
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            const r = await saveContact(customerId, contact?.id ?? null, fd);
            if (!r.ok) setError(r.error);
            else {
              toast.success(r.message ?? "Saved");
              onDone();
            }
          });
        }}
      >
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="c-name" required>
            <Input id="c-name" name="name" defaultValue={contact?.name ?? ""} autoFocus />
          </Field>
          <Field label="Title" htmlFor="c-title">
            <Input id="c-title" name="title" defaultValue={contact?.title ?? ""} placeholder="Office Manager" />
          </Field>
          <Field label="Phone" htmlFor="c-phone">
            <Input id="c-phone" name="phone" type="tel" defaultValue={contact?.phone ?? ""} />
          </Field>
          <Field label="Email" htmlFor="c-email">
            <Input id="c-email" name="email" type="email" defaultValue={contact?.email ?? ""} />
          </Field>
        </div>
        <Field label="Notes" htmlFor="c-notes">
          <Textarea id="c-notes" name="notes" defaultValue={contact?.notes ?? ""} rows={2} placeholder="Best time to call, approves proofs, etc." />
        </Field>
        <Checkbox name="isPrimary" defaultChecked={contact ? contact.isPrimary : firstContact} label="Main contact" hint="The person we reach out to first." />
        <div className="flex justify-end gap-2 pt-1">
          <DialogClose asChild>
            <Button disabled={pending}>Cancel</Button>
          </DialogClose>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {contact ? "Save contact" : "Add contact"}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
