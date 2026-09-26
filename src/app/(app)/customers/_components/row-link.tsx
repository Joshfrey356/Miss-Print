"use client";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/** Table row that opens `href` when clicked anywhere (links inside the row still work on their own). */
export function RowLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tr
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button,input,select,textarea")) return;
        if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
        else router.push(href);
      }}
      className={cn("cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50", className)}
    >
      {children}
    </tr>
  );
}
