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

/**
 * Each shop names its own locations, so colors follow a location's place in the shop's
 * sorted list (first = brand color), not its code. Unknown → the brand color.
 */
const LOCATION_TONES = [
  { text: "text-brand-700", chip: "bg-brand-50 text-brand-700" },
  { text: "text-teal-700", chip: "bg-teal-50 text-teal-700" },
  { text: "text-violet-700", chip: "bg-violet-50 text-violet-700" },
  { text: "text-sky-700", chip: "bg-sky-50 text-sky-700" },
  { text: "text-amber-700", chip: "bg-amber-50 text-amber-700" },
  { text: "text-rose-700", chip: "bg-rose-50 text-rose-700" },
];
export function locationTone(index: number | null | undefined) {
  return LOCATION_TONES[index != null && index >= 0 ? index % LOCATION_TONES.length : 0]!;
}

/** `index` = the location's position in the shop's sorted location list (see getLocations). */
export function LocationTag({ name, index }: { name: string | null; index?: number | null }) {
  if (!name) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", locationTone(index).text)}>
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
