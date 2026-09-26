import * as React from "react";
import { cn } from "@/lib/utils";

const field =
  "block w-full rounded-lg border border-slate-300 bg-white px-3 text-[15px] text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50 disabled:text-slate-500 tabular";

/** Number input with a unit shown on the right ("%", "hr", "days"). */
export const SuffixInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { suffix: string }>(
  function SuffixInput({ suffix, className, ...props }, ref) {
    return (
      <div className="relative">
        <input ref={ref} inputMode="decimal" className={cn(field, "h-10 pr-12", className)} {...props} />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-400">{suffix}</span>
      </div>
    );
  },
);

/** One labelled setting with a plain-English explanation next to it. */
export function RuleRow({
  label,
  help,
  htmlFor,
  children,
}: {
  label: string;
  help: React.ReactNode;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 border-b border-slate-100 py-4 last:border-0 sm:grid-cols-[1fr_12rem] sm:items-center sm:gap-6">
      <div>
        <label htmlFor={htmlFor} className="block text-[15px] font-semibold text-slate-900">
          {label}
        </label>
        <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{help}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}
