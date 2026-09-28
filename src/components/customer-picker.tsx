"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Building2, Check, ExternalLink, Loader2, Plus, Search, User, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { quickCreateCustomer } from "@/app/(app)/customers/actions";

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
  const [adding, setAdding] = useState(false);
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

  const quickAdd = <QuickAddCustomer open={adding} onOpenChange={setAdding} typed={q} onCreated={(c) => onChange(c)} />;

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
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setAdding(true);
            }}
            className="flex w-full items-center gap-1.5 border-t border-slate-100 px-3 py-2.5 text-left text-sm font-medium text-brand-600 hover:bg-slate-50"
          >
            <Plus className="size-4" />
            {q.trim() ? `Add “${q.trim()}” as a new customer` : "Add a new customer"}
          </button>
        </div>
      )}
      {quickAdd}
    </div>
  );
}

/** What was typed in the search box, sorted into name / phone / email for the new customer. */
function fromTyped(typed: string) {
  const t = typed.trim();
  if (/@/.test(t)) return { name: "", phone: "", email: t };
  if (t.replace(/\D/g, "").length >= 7 && /^[\d\s()+.-]+$/.test(t)) return { name: "", phone: t, email: "" };
  return { name: t, phone: "", email: "" };
}

type Dupe = { id: number; name: string; reason: string; city: string | null; archived: boolean };

/**
 * Add a customer without leaving the page (counter sale, quote, new job keep what's been typed).
 * Just the basics; the full customer form has everything else.
 */
function QuickAddCustomer({ open, onOpenChange, typed, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; typed: string; onCreated: (c: PickedCustomer) => void }) {
  const [isCompany, setIsCompany] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [contactName, setContactName] = useState("");
  const [taxExempt, setTaxExempt] = useState(false);
  const [dupes, setDupes] = useState<Dupe[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    const f = fromTyped(typed);
    setName(f.name);
    setPhone(f.phone);
    setEmail(f.email);
    setContactName("");
    setTaxExempt(false);
    setIsCompany(true);
    setDupes(null);
    setError(null);
  }, [open, typed]);

  const save = (confirmDuplicate: boolean) =>
    start(async () => {
      const r = await quickCreateCustomer({ isCompany, name, phone, email, taxExempt, contactName: isCompany ? contactName : null, confirmDuplicate });
      if (!r.ok) return setError(r.error);
      if (r.data?.duplicates?.length) {
        setError(null);
        return setDupes(r.data.duplicates);
      }
      if (r.data?.customer) {
        toast.success(`${r.data.customer.name} added`);
        onOpenChange(false);
        onCreated(r.data.customer);
      }
    });

  const pickExisting = (id: number) =>
    start(async () => {
      const res = await fetch(`/api/customers/search?id=${id}`);
      const c = ((await res.json()).customers ?? [])[0] as PickedCustomer | undefined;
      if (!c) return setError("That customer is archived. Restore it on the Customers page first.");
      onOpenChange(false);
      onCreated(c);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add a new customer" description="Just the basics — you can add the address, terms and more later.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            // The dialog is portaled, but React still bubbles submit to a surrounding form: stop it here.
            e.preventDefault();
            e.stopPropagation();
            save(false);
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: true, label: "Business", icon: Building2 },
              { v: false, label: "Person", icon: User },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => setIsCompany(o.v)}
                className={cn("flex h-11 items-center justify-center gap-2 rounded-lg border text-[15px] font-medium", isCompany === o.v ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-300 bg-white text-slate-700")}
              >
                <o.icon className="size-4" />
                {o.label}
              </button>
            ))}
          </div>
          <Field label={isCompany ? "Business name" : "Name"} htmlFor="qa-name" required>
            <Input id="qa-name" value={name} onChange={(e) => { setName(e.target.value); setDupes(null); }} required maxLength={200} autoFocus className="h-11" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" htmlFor="qa-phone">
              <Input id="qa-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setDupes(null); }} maxLength={40} className="h-11" />
            </Field>
            <Field label="Email" htmlFor="qa-email">
              <Input id="qa-email" type="email" inputMode="email" value={email} onChange={(e) => { setEmail(e.target.value); setDupes(null); }} maxLength={200} className="h-11" />
            </Field>
          </div>
          {isCompany && (
            <Field label="Contact person" htmlFor="qa-contact" hint="Optional — saved as the primary contact.">
              <Input id="qa-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={200} className="h-11" />
            </Field>
          )}
          <label className="flex cursor-pointer items-center gap-2.5 text-[15px] text-slate-800">
            <input type="checkbox" checked={taxExempt} onChange={(e) => setTaxExempt(e.target.checked)} className="size-[18px] accent-brand-500" />
            Tax exempt
          </label>

          {dupes && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">This might already be a customer:</p>
              <ul className="mt-2 space-y-1.5">
                {dupes.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium text-slate-900">{d.name}</span>
                      <span className="text-slate-600">
                        {d.city ? ` · ${d.city}` : ""} · {d.reason}
                        {d.archived ? " · archived" : ""}
                      </span>
                    </span>
                    {!d.archived && (
                      <Button size="sm" onClick={() => pickExisting(d.id)} disabled={pending}>
                        Use this one
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[15px] font-medium text-red-700">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href="/customers/new" target="_blank" className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline">
              Full customer form <ExternalLink className="size-3.5" />
            </Link>
            <div className="flex gap-2">
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              {dupes ? (
                <Button variant="primary" disabled={pending} onClick={() => save(true)}>
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  Add anyway
                </Button>
              ) : (
                <Button type="submit" variant="primary" disabled={pending || !name.trim()}>
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  Add customer
                </Button>
              )}
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
