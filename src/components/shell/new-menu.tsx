"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Briefcase, FileText, Plus, Receipt, UserPlus } from "lucide-react";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/components/ui/dropdown";

export type NewOptions = { quote: boolean; job: boolean; customer: boolean; expense: boolean };

export function NewMenu({ options, compact }: { options: NewOptions; compact?: boolean }) {
  const router = useRouter();
  // Keyboard shortcuts (not while typing): Q = new quote, J = new job
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.key === "q" && options.quote) router.push("/quotes/new");
      if (e.key === "j" && options.job) router.push("/jobs/new");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, router]);

  const items = [
    options.quote && { href: "/quotes/new", label: "New Quote", icon: FileText, kbd: "Q" },
    options.job && { href: "/jobs/new", label: "New Job", icon: Briefcase, kbd: "J" },
    options.customer && { href: "/customers/new", label: "New Customer", icon: UserPlus },
    options.expense && { href: "/money/expenses/new", label: "New Expense", icon: Receipt },
  ].filter(Boolean) as { href: string; label: string; icon: typeof Plus; kbd?: string }[];
  if (!items.length) return null;

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand-500 px-4 text-[15px] font-semibold text-white shadow-sm hover:bg-brand-600">
          <Plus className="size-5" strokeWidth={2.5} />
          {!compact && "New"}
        </button>
      </DropdownTrigger>
      <DropdownContent>
        {items.map((i) => (
          <DropdownItem key={i.href} asChild>
            <Link href={i.href}>
              <i.icon className="size-4 text-slate-400" />
              <span className="flex-1">{i.label}</span>
              {i.kbd && <kbd className="rounded border border-slate-200 px-1.5 text-[11px] text-slate-400">{i.kbd}</kbd>}
            </Link>
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}
