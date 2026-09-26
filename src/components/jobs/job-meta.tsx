import { CalendarClock, MapPin } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { dueLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DueText({ dueDate, overdue, className }: { dueDate: string | null; overdue?: boolean; className?: string }) {
  const label = dueLabel(dueDate);
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", overdue ? "font-semibold text-red-600" : label === "Today" ? "font-semibold text-amber-700" : "text-slate-600", className)}>
      <CalendarClock className="size-3.5 shrink-0" />
      {label}
    </span>
  );
}

export function LocationTag({ code, name }: { code: string | null; name: string | null }) {
  if (!name) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", code === "HAMMOND" ? "text-teal-700" : code === "OFFSITE" ? "text-violet-700" : "text-brand-700")}>
      <MapPin className="size-3" />
      {name}
    </span>
  );
}

export function OwnerTag({ name, color }: { name: string | null; color: string | null }) {
  if (!name) return <span className="text-xs text-slate-400">Unassigned</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
      <Avatar name={name} color={color} size="sm" />
      {name.split(" ")[0]}
    </span>
  );
}
