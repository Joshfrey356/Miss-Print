import { cn } from "@/lib/utils";

/** Miss Print wordmark (recreated as live text so it stays crisp at any size). */
export function Logo({ className, compact, inverted }: { className?: string; compact?: boolean; inverted?: boolean }) {
  return (
    <div className={cn("flex flex-col leading-none select-none", className)} aria-label="Miss Print — Print · Design · Signs">
      <span className="font-black tracking-tight text-brand-500" style={{ fontSize: compact ? 18 : 22, letterSpacing: "-0.01em" }}>
        MISS PRINT
      </span>
      {!compact && (
        <span className={cn("mt-1 text-[8.5px] font-bold tracking-[0.2em]", inverted ? "text-white" : "text-slate-900")}>
          PRINT · DESIGN · SIGNS
        </span>
      )}
    </div>
  );
}
