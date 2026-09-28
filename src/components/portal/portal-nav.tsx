"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/portal/home", label: "Home", count: null },
  { href: "/portal/jobs", label: "Orders", count: null },
  { href: "/portal/quotes", label: "Quotes", count: "quotes" },
  { href: "/portal/invoices", label: "Invoices", count: "invoices" },
] as const;

export function PortalNav({ counts, askHref }: { counts: { quotes: number; invoices: number; proofs: number }; askHref: string | null }) {
  const pathname = usePathname();
  const items = [...ITEMS, ...(askHref ? [{ href: askHref, label: "Ask us", count: null }] : [])] as { href: string; label: string; count: "quotes" | "invoices" | null }[];
  return (
    <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2 sm:px-4" aria-label="Portal">
      {items.map((i) => {
        const active = pathname === i.href || pathname.startsWith(i.href + "/") || (i.label === "Ask us" && (pathname.startsWith("/portal/message") || pathname.startsWith("/portal/request")));
        const n = i.count ? counts[i.count] : 0;
        return (
          <Link
            key={i.href}
            href={i.href}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-[15px] font-medium sm:px-3",
              active ? "border-brand-500 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900",
            )}
          >
            {i.label}
            {n > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
