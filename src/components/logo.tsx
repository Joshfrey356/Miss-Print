import { cn } from "@/lib/utils";

export type LogoBrand = { name: string; tagline?: string | null; logoUrl?: string | null };

/**
 * The shop's brand (white-label): its uploaded logo, or else its name as a wordmark
 * (live text, so it stays crisp at any size). Set both in Settings → Company Profile.
 * With no brand (e.g. a first visit to /login) it shows `fallbackName`.
 */
export function Logo({
  brand,
  fallbackName = "Command Center",
  className,
  compact,
  inverted,
}: {
  brand: LogoBrand | null;
  fallbackName?: string;
  className?: string;
  compact?: boolean;
  inverted?: boolean;
}) {
  const name = brand?.name?.trim() || fallbackName;
  const tagline = brand ? brand.tagline?.trim() : null;
  if (brand?.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo of unknown size
      <img src={brand.logoUrl} alt={name} className={cn("block w-auto max-w-full object-contain object-left", compact ? "max-h-8" : "max-h-12", className)} />
    );
  }
  const size = compact ? 18 : name.length > 22 ? 15 : name.length > 14 ? 18 : 22;
  return (
    <div className={cn("flex flex-col leading-none select-none", className)} aria-label={tagline ? `${name} — ${tagline}` : name}>
      <span className="font-black uppercase tracking-tight text-brand-500 [overflow-wrap:anywhere]" style={{ fontSize: size, letterSpacing: "-0.01em", lineHeight: 1.05 }}>
        {name}
      </span>
      {!compact && tagline && (
        <span className={cn("mt-1 text-[8.5px] font-bold uppercase tracking-[0.2em]", inverted ? "text-white" : "text-slate-900")}>{tagline}</span>
      )}
    </div>
  );
}
