"use client";
import * as React from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/input";
import type { AutomationSettings } from "@/lib/settings";
import { ActionForm, SaveButton } from "../_components/action-form";
import { SuffixInput } from "../_components/inputs";
import { saveAutomations } from "../actions";

type DayKey = Exclude<keyof AutomationSettings, "enabled">;
const ROWS: { key: DayKey; label: string; help: string }[] = [
  { key: "quoteReminderDays", label: "Remind the customer about a quote", help: "Friendly email if they haven't answered a quote after this many days." },
  { key: "quoteFollowupDays", label: "Remind the salesperson to call", help: "Creates a task to follow up by phone after this many days." },
  { key: "quoteAlertDays", label: "Tell the owner about old quotes", help: "Flags quotes still unanswered after this many days." },
  { key: "proofReminderDays", label: "Remind the customer about a proof", help: "If a proof hasn't been approved after this many days." },
  { key: "invoiceReminderDays", label: "Payment reminder", help: "Email the customer when an invoice is this many days past due." },
];

function DayRow({ row, value }: { row: (typeof ROWS)[number]; value: number | null }) {
  const [on, setOn] = React.useState(value != null);
  return (
    <div className="grid gap-2 border-b border-slate-100 py-4 last:border-0 sm:grid-cols-[1fr_10rem] sm:items-center sm:gap-6">
      <Checkbox name={`${row.key}On`} checked={on} onChange={(e) => setOn(e.target.checked)} label={<span className="font-semibold">{row.label}</span>} hint={row.help} />
      <SuffixInput name={row.key} suffix="days" inputMode="numeric" defaultValue={value ?? ""} disabled={!on} aria-label={`${row.label} — days`} />
    </div>
  );
}

export function AutomationsForm({ automations }: { automations: AutomationSettings }) {
  return (
    <ActionForm action={saveAutomations}>
      <Card>
        <CardHeader title="Reminders" description="Turn on the ones you want. All are off until Phase 2 turns them on." />
        <CardBody className="py-0">
          <div className="border-b border-slate-100 py-4">
            <Checkbox
              name="enabled"
              defaultChecked={automations.enabled}
              label={<span className="font-semibold">Allow automatic customer messages (once Phase 2 is ready)</span>}
              hint="Master switch. While this is off, nothing is sent even if a reminder below is on."
            />
          </div>
          {ROWS.map((r) => (
            <DayRow key={r.key} row={r} value={automations[r.key]} />
          ))}
        </CardBody>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <SaveButton pendingText="Saving…">Save reminders</SaveButton>
        </div>
      </Card>
    </ActionForm>
  );
}
