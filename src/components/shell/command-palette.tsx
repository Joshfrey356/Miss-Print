"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useJobNo } from "@/components/shop-context";
import { Command } from "cmdk";
import * as D from "@radix-ui/react-dialog";
import { Briefcase, FileText, Loader2, Receipt, Search, User, Users } from "lucide-react";

type Result = { type: "job" | "customer" | "contact" | "quote" | "invoice"; id: number; title: string; subtitle?: string; href: string; meta?: string };

const ICONS = { job: Briefcase, customer: Users, contact: User, quote: FileText, invoice: Receipt };
const GROUPS: { type: Result["type"]; label: string }[] = [
  { type: "job", label: "Jobs" },
  { type: "customer", label: "Customers" },
  { type: "contact", label: "Contacts" },
  { type: "quote", label: "Quotes" },
  { type: "invoice", label: "Invoices" },
];

export function SearchButton({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      {compact ? (
        <button onClick={() => setOpen(true)} aria-label="Search" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
          <Search className="size-5" />
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex h-10 w-full max-w-md items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[15px] text-slate-400 hover:border-slate-300 hover:bg-white"
        >
          <Search className="size-4" />
          <span className="flex-1 text-left">Search customers, jobs, phone, invoice…</span>
          <kbd className="rounded border border-slate-200 bg-white px-1.5 text-xs text-slate-400">⌘K</kbd>
        </button>
      )}
      <CommandPalette open={open} onOpenChange={setOpen} />
    </>
  );
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const jobNo = useJobNo();
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    if (!open) {
      setQ("");
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        const json = (await res.json()) as { results: Result[] };
        if (id === reqId.current) setResults(json.results ?? []);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-slate-900/40" />
        <D.Content className="fixed left-1/2 top-[10vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl bg-white shadow-2xl">
          <D.Title className="sr-only">Search</D.Title>
          <D.Description className="sr-only">Search customers, jobs, quotes and invoices</D.Description>
          <Command shouldFilter={false} label="Search">
            <div className="flex items-center gap-3 border-b border-slate-100 px-4">
              {loading ? <Loader2 className="size-5 animate-spin text-slate-400" /> : <Search className="size-5 text-slate-400" />}
              <Command.Input
                value={q}
                onValueChange={setQ}
                autoFocus
                placeholder={`Customer, ${jobNo(10428)}, phone, email, “4x8 banner”…`}
                className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-slate-400"
              />
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-2">
              {q.trim().length >= 2 && !loading && (
                <Command.Empty className="px-4 py-8 text-center text-sm text-slate-500">
                  Nothing matches “{q.trim()}”. Try a company name, job number or phone number.
                </Command.Empty>
              )}
              {q.trim().length < 2 && (
                <div className="px-4 py-6 text-sm text-slate-500">
                  <p className="font-medium text-slate-700">Search everything</p>
                  <p className="mt-1">Type a customer name, job number ({jobNo(10428)}), quote (Q-5012), invoice (INV-7001), phone, email or a product like “banner”.</p>
                </div>
              )}
              {GROUPS.map((g) => {
                const items = results.filter((r) => r.type === g.type);
                if (!items.length) return null;
                const Icon = ICONS[g.type];
                return (
                  <Command.Group
                    key={g.type}
                    heading={g.label}
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-slate-400"
                  >
                    {items.map((r) => (
                      <Command.Item
                        key={`${r.type}-${r.id}`}
                        value={`${r.type}-${r.id}`}
                        onSelect={() => go(r.href)}
                        className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 data-[selected=true]:bg-brand-50"
                      >
                        <Icon className="size-4 shrink-0 text-slate-400" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-medium text-slate-800">{r.title}</div>
                          {r.subtitle && <div className="truncate text-sm text-slate-500">{r.subtitle}</div>}
                        </div>
                        {r.meta && <span className="shrink-0 text-xs text-slate-400">{r.meta}</span>}
                      </Command.Item>
                    ))}
                  </Command.Group>
                );
              })}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
