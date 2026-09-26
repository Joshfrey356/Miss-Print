import Link from "next/link";
import { Columns3, List } from "lucide-react";
import { cn } from "@/lib/utils";

export function ViewToggle({ active }: { active: "list" | "board" }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 shadow-sm">
      <Link href="/jobs" className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", active === "list" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-800")}>
        <List className="size-4" /> List
      </Link>
      <Link href="/jobs/board" className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", active === "board" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-800")}>
        <Columns3 className="size-4" /> Board
      </Link>
    </div>
  );
}

