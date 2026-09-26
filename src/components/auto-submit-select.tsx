"use client";
import { cn } from "@/lib/utils";

/** A <select> inside a GET form that submits as soon as it changes. */
export function AutoSubmitSelect({ name, value, label, options, className }: { name: string; value?: string; label: string; options: { value: string; label: string }[]; className?: string }) {
  return (
    <select
      name={name}
      defaultValue={value ?? ""}
      aria-label={label}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className={cn(
        "h-9 rounded-full border border-slate-200 bg-white pl-3.5 pr-8 text-sm font-medium text-slate-700 hover:border-slate-300",
        value && "border-brand-500 text-brand-700",
        className,
      )}
    >
      <option value="">{`Any ${label.toLowerCase()}`}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
