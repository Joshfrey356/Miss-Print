"use client";
import { useState, useTransition } from "react";
import { Check, Copy, Loader2, Send, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { timeAgo } from "@/lib/format";
import { inviteToPortal, turnOffPortalAccess } from "./access-actions";

type Person = { contactId: number | null; name: string; email: string };
type Row = { email: string; contactName: string | null; invitedAt: string | null; lastVisit: string | null; signedIn: boolean; blocked: boolean };

export function PortalInviteButton({ customerId, people, email: preset, label = "Invite" }: { customerId: number; people: Person[]; email?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string>(preset ?? people[0]?.email ?? "");
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const other = pick === "__other" || people.length === 0;
  const email = other ? typed : pick;
  const person = people.find((p) => p.email === pick);

  const send = () =>
    start(async () => {
      const r = await inviteToPortal(customerId, { contactId: other ? null : (person?.contactId ?? null), email });
      if (!r.ok) return void toast.error(r.error);
      if (r.data?.emailed) {
        toast.success(`Sign-in link emailed to ${email}`);
        setOpen(false);
      } else {
        toast.message(r.data?.error ?? "The email couldn't be sent.", { description: "Copy the link below and send it yourself." });
        setLink(r.data?.link ?? null);
      }
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setLink(null);
          setCopied(false);
        }
      }}
    >
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <UserPlus className="size-3.5" /> {label}
      </Button>
      <DialogContent title="Invite to the customer portal" description="We'll email them a sign-in link from your shop. No password needed — the link works once, for 7 days.">
        {link ? (
          <div className="space-y-3">
            <p className="text-[15px] text-slate-700">Email isn&apos;t set up on this server, so copy this sign-in link and send it to {email}:</p>
            <div className="flex gap-2">
              <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button
                onClick={() => {
                  navigator.clipboard?.writeText(link).then(() => setCopied(true));
                }}
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {people.length > 0 && (
              <Field label="Who?">
                <Select value={pick} onChange={(e) => setPick(e.target.value)}>
                  {people.map((p) => (
                    <option key={p.email} value={p.email}>
                      {p.name} — {p.email}
                    </option>
                  ))}
                  <option value="__other">Someone else (type an email)</option>
                </Select>
              </Field>
            )}
            {other && (
              <Field label="Email" hint={people.length === 0 ? "This customer has no contact with an email yet." : undefined}>
                <Input type="email" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="name@company.com" autoFocus />
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" disabled={pending || !email.trim()} onClick={send}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send sign-in link
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PortalAccessList({ customerId, rows, canEdit, portalUrl }: { customerId: number; rows: Row[]; canEdit: boolean; portalUrl: string | null }) {
  if (rows.length === 0 && !portalUrl) return <p className="px-5 py-4 text-[15px] text-slate-500">Nobody has portal access yet.</p>;
  if (rows.length === 0 && portalUrl)
    return (
      <p className="px-5 py-4 text-[15px] text-slate-500">
        Nobody has portal access yet.{canEdit ? " Invite a contact to get them started." : ""} Customers can also sign in at{" "}
        <a href={portalUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">
          {portalUrl.split("?")[0]}
        </a>{" "}
        with an email on file.
      </p>
    );
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((r) => (
        <li key={r.email} className="flex items-start justify-between gap-2 px-5 py-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-slate-900">
              <span className="truncate">{r.contactName ?? r.email}</span>
              {r.blocked ? <Badge tone="gray">Access off</Badge> : r.signedIn ? <Badge tone="green">Signed in</Badge> : r.invitedAt ? <Badge tone="amber">Invited</Badge> : null}
            </p>
            {r.contactName && <p className="truncate text-sm text-slate-500">{r.email}</p>}
            <p className="text-sm text-slate-500">
              {r.lastVisit ? `Last visit ${timeAgo(new Date(r.lastVisit))}` : r.invitedAt ? `Invited ${timeAgo(new Date(r.invitedAt))} · hasn't signed in yet` : ""}
            </p>
          </div>
          {canEdit &&
            (r.blocked ? (
              <PortalInviteButton customerId={customerId} people={[{ contactId: null, name: r.contactName ?? r.email, email: r.email }]} email={r.email} label="Turn on" />
            ) : (
              <TurnOff customerId={customerId} email={r.email} name={r.contactName ?? r.email} />
            ))}
        </li>
      ))}
    </ul>
  );
}

function TurnOff({ customerId, email, name }: { customerId: number; email: string; name: string }) {
  return (
    <Confirm
      title={`Turn off portal access for ${name}?`}
      description="Their sign-in links stop working and they're signed out everywhere. You can invite them again any time."
      confirmLabel="Turn off access"
      onConfirm={async () => {
        const r = await turnOffPortalAccess(customerId, email);
        if (r.ok) toast.success("Portal access turned off");
        else toast.error(r.error);
      }}
    >
      <Button size="sm" variant="ghost" className="shrink-0 text-slate-500 hover:text-red-700">
        Turn off
      </Button>
    </Confirm>
  );
}
