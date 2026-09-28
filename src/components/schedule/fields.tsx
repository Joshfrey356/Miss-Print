"use client";
import * as React from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Field, Input, Select } from "@/components/ui/input";
import type { Issue } from "@/lib/schedule/logic";
import { capacityLabel } from "@/lib/schedule/logic";
import { fromTimeInput } from "@/lib/schedule/time";
import { MACHINE_KIND_SHORT, type BoardMachine } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";

export function MachineSelect({ id, machines, value, onChange }: { id: string; machines: BoardMachine[]; value: number | null; onChange: (id: number) => void }) {
  return (
    <Select id={id} value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} required>
      {value == null && <option value="">Pick a machine…</option>}
      {machines.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name} ({MACHINE_KIND_SHORT[m.kind]})
        </option>
      ))}
    </Select>
  );
}

const HOURS = Array.from({ length: 49 }, (_, i) => i);
const MINS = [0, 15, 30, 45];

/** Length as hours + minutes pickers (15-minute steps): works with a keyboard and on a phone. */
export function LengthFields({ idPrefix, minutes, onChange }: { idPrefix: string; minutes: number; onChange: (m: number) => void }) {
  const h = Math.floor(minutes / 60);
  const m = Math.round((minutes % 60) / 15) * 15;
  return (
    <div className="flex items-center gap-2">
      <Select id={`${idPrefix}-h`} aria-label="Hours" value={Math.min(h, 48)} onChange={(e) => onChange(Math.max(15, Number(e.target.value) * 60 + m))} className="w-28">
        {HOURS.map((x) => (
          <option key={x} value={x}>
            {x} hr
          </option>
        ))}
      </Select>
      <Select id={`${idPrefix}-m`} aria-label="Minutes" value={m % 60} onChange={(e) => onChange(Math.max(15, h * 60 + Number(e.target.value)))} className="w-28">
        {MINS.map((x) => (
          <option key={x} value={x}>
            {x} min
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Date + start time inputs (shop time). */
export function WhenFields({
  idPrefix,
  ymd,
  time,
  onYmd,
  onTime,
}: {
  idPrefix: string;
  ymd: string;
  time: string;
  onYmd: (v: string) => void;
  onTime: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Date" htmlFor={`${idPrefix}-date`}>
        <Input id={`${idPrefix}-date`} type="date" value={ymd} onChange={(e) => onYmd(e.target.value)} required />
      </Field>
      <Field label="Start time" htmlFor={`${idPrefix}-time`}>
        <Input id={`${idPrefix}-time`} type="time" step={900} value={time} onChange={(e) => onTime(e.target.value)} required aria-invalid={fromTimeInput(time) == null} />
      </Field>
    </div>
  );
}

export function MachineHours({ machine }: { machine: BoardMachine | undefined }) {
  if (!machine) return null;
  return <p className="mt-1 text-xs text-slate-500">Runs {capacityLabel(machine)}</p>;
}

/** Warnings shown before saving. Saving is still allowed. */
export function IssueList({ issues, okText }: { issues: Issue[]; okText?: string }) {
  if (!issues.length)
    return okText ? (
      <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <CheckCircle2 className="size-4 shrink-0" /> {okText}
      </p>
    ) : null;
  return (
    <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
      {issues.map((i, n) => (
        <li key={n} className={cn("flex items-start gap-2", i.kind === "late" && "font-medium text-red-700")}>
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {i.text}
        </li>
      ))}
      <li className="pl-6 text-xs text-amber-800">You can still save it.</li>
    </ul>
  );
}
