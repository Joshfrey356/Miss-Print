"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Building2, Check, Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type PickedCustomer = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  taxExempt: boolean;
  discountPct: number;
  poRequired: boolean;
  salespersonId: number | null;
  contacts: { id: number; name: string; email: string | null; isPrimary: boolean }[];
};

/** Type-ahead customer search. Shows the selected customer as a chip. */
export function CustomerPicker({ value, onChange, autoFocus }: { value: PickedCustomer | null; onChange: (c: PickedCustomer | null) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<PickedCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      setResults(json.customers ?? []);
      setHi(0);
      setLoading(false);
    }, 120);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (value)
    return (
      <div className="flex items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2 shadow-sm">
        <Building2 className="size-5 text-slate-400" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{value.name}</p>
          <p className="truncate text-sm text-slate-500">
            {[value.phone, value.email, value.city].filter(Boolean).join(" · ")}
            {value.taxExempt && " · Tax exempt"}
            {value.discountPct > 0 && ` · ${Math.round(value.discountPct * 100)}% discount`}
            {value.poRequired && " · PO required"}
          </p>
        </div>
        <button type="button" onClick={() => onChange(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Change customer">
          <X className="size-4" />
        </button>
      </div>
    );

  return (
    <div ref={box} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <input
        value={q}
        autoFocus={autoFocus}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setHi((h) => Math.min(h + 1, results.length - 1));
          if (e.key === "ArrowUp") setHi((h) => Math.max(h - 1, 0));
          if (e.key === "Enter" && results[hi]) {
            e.preventDefault();
            onChange(results[hi]!);
            setOpen(false);
          }
        }}
        placeholder="Search customer by name, phone, email or contact…"
        className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-9 text-[15px] shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
      {loading && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-slate-400" />}
      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {results.map((c, i) => (
            <button
              type="button"
              key={c.id}
              onMouseEnter={() => setHi(i)}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
              className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left", i === hi && "bg-brand-50")}
            >
              <Building2 className="size-4 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-800">{c.name}</span>
                <span className="block truncate text-sm text-slate-500">{[c.phone, c.city].filter(Boolean).join(" · ")}</span>
              </span>
              {i === hi && <Check className="size-4 text-brand-500" />}
            </button>
          ))}
          {!loading && results.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">No customers match “{q}”.</p>}
          <Link href="/customers/new" className="block border-t border-slate-100 px-3 py-2.5 text-sm font-medium text-brand-600 hover:bg-slate-50">
            + Add a new customer
          </Link>
        </div>
      )}
    </div>
  );
}
