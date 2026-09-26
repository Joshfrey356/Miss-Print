"use client";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { useServerAction } from "@/components/use-action";
import { updateCustomerNotes } from "../actions";

export function NotesCard({ customerId, notes, canEdit }: { customerId: number; notes: string | null; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(notes ?? "");
  const [pending, run] = useServerAction();
  return (
    <Card>
      <CardHeader
        title="Notes"
        action={
          canEdit &&
          !editing && (
            <Button size="sm" variant="ghost" onClick={() => { setValue(notes ?? ""); setEditing(true); }}>
              <Pencil className="size-3.5" />
              {notes ? "Edit" : "Add"}
            </Button>
          )
        }
      />
      <CardBody>
        {editing ? (
          <div className="space-y-3">
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={6}
              autoFocus
              aria-label="Customer notes"
              placeholder="Preferences, gate codes, who approves proofs…"
            />
            <div className="flex gap-2">
              <Button variant="primary" disabled={pending} onClick={() => run(() => updateCustomerNotes(customerId, value), { onSuccess: () => setEditing(false) })}>
                {pending ? "Saving…" : "Save notes"}
              </Button>
              <Button variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : notes ? (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">{notes}</p>
        ) : (
          <p className="text-[15px] text-slate-500">No notes about this customer yet.</p>
        )}
      </CardBody>
    </Card>
  );
}
