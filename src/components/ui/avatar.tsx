import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Avatar({ name, color, size = "md", className }: { name: string; color?: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  const s = size === "sm" ? "size-6 text-[10px]" : size === "lg" ? "size-10 text-sm" : "size-8 text-xs";
  return (
    <span
      title={name}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", s, className)}
      style={{ backgroundColor: color ?? "#64748b" }}
    >
      {initials(name)}
    </span>
  );
}
