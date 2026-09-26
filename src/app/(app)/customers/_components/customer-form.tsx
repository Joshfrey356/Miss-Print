"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Building2, Loader2, User } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { checkDuplicates, saveCustomer } from "../actions";

type Terms = "due_on_receipt" | "net_15" | "net_30" | "net_45" | "net_60";
type Dup = { id: number; name: string; reason: string; city: string | null; archived: boolean };

export type CustomerFormValues = {
  isCompany: boolean;
  name: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  billingAddress: string;
  paymentTerms: Terms;
  taxExempt: boolean;
  taxExemptId: string;
  poRequired: boolean;
  discountPercent: string;
  salespersonId: string;
  customerSince: string;
  notes: string;
  contactName: string;
  contactTitle: string;
  contactEmail: string;
  contactPhone: string;
};

export function CustomerForm({
  customerId,
  initial,
  salespeople,
  termsLabels,
  cancelHref,
}: {
  customerId: number | null;
  initial: CustomerFormValues;
  salespeople: { id: number; name: string }[];
  termsLabels: Record<Terms, string>;
  cancelHref: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isCompany, setIsCompany] = useState(initial.isCompany);
  const [sameBilling, setSameBilling] = useState(!initial.billingAddress);
  const [taxExempt, setTaxExempt] = useState(initial.taxExempt);
  const [error, setError] = useState<string | null>(null);
  const [dups, setDups] = useState<Dup[]>([]);
  const [mustConfirm, setMustConfirm] = useState(false);
  const [pending, start] = useTransition();
  const lastCheck = useRef("");

  async function runDupCheck() {
    const f = formRef.current;
    if (!f) return;
    const get = (n: string) => (f.elements.namedItem(n) as HTMLInputElement | null)?.value.trim() ?? "";
    const input = { name: get("name"), phone: get("phone"), email: get("email") };
    const key = JSON.stringify(input);
    if (key === lastCheck.current) return;
    lastCheck.current = key;
    if (input.name.length < 3 && input.phone.replace(/\D/g, "").length < 7 && !input.email.includes("@")) {
      setDups([]);
      return;
    }
    const r = await checkDuplicates({ ...input, excludeId: customerId });
    if (r.ok) setDups(r.data ?? []);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (mustConfirm) fd.set("confirmDuplicate", "1");
    setError(null);
    start(async () => {
      const r = await saveCustomer(customerId, fd);
      if (!r.ok) {
        setError(r.error);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (r.data?.duplicates?.length) {
        setDups(r.data.duplicates);
        setMustConfirm(true);
      }
    });
  }

  const dupBox = dups.length > 0 && (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[15px] text-amber-900">
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-4" />
        {dups.length === 1 ? "Possible duplicate" : "Possible duplicates"}
      </p>
      <ul className="mt-1.5 space-y-1">
        {dups.map((d) => (
          <li key={d.id}>
            <span className="font-medium">{d.name}</span>
            {d.city && <span className="text-amber-800"> · {d.city}</span>}
            <span className="text-amber-800"> ({d.reason}{d.archived ? ", archived" : ""})</span> —{" "}
            <Link href={`/customers/${d.id}`} className="font-medium underline underline-offset-2 hover:text-amber-950">
              open it?
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-sm text-amber-800">If this really is a different customer, you can still save.</p>
    </div>
  );

  return (
    <form ref={formRef} onSubmit={submit} className="max-w-4xl space-y-5" noValidate>
      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[15px] font-medium text-red-800">
          {error}
        </div>
      )}

      <Card>
        <CardHeader title="Who is this?" />
        <CardBody className="space-y-4">
          <div className="inline-flex rounded-lg border border-slate-300 bg-slate-50 p-1" role="radiogroup" aria-label="Customer type">
            {[
              { v: true, label: "Company", icon: Building2 },
              { v: false, label: "Individual", icon: User },
            ].map((o) => (
              <label
                key={o.label}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-4 py-2 text-[15px] font-medium",
                  isCompany === o.v ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900",
                )}
              >
                <input
                  type="radio"
                  name="kind"
                  value={o.v ? "company" : "individual"}
                  checked={isCompany === o.v}
                  onChange={() => setIsCompany(o.v)}
                  className="sr-only"
                />
                <o.icon className="size-4" />
                {o.label}
              </label>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={isCompany ? "Company name" : "Full name"} htmlFor="name" required className="sm:col-span-2">
              <Input id="name" name="name" defaultValue={initial.name} autoFocus={!customerId} onBlur={runDupCheck} autoComplete="off" className="h-11 text-base" />
            </Field>
            <Field label="Phone" htmlFor="phone">
              <Input id="phone" name="phone" type="tel" defaultValue={initial.phone} onBlur={runDupCheck} placeholder="219-555-0100" />
            </Field>
            <Field label="Email" htmlFor="email">
              <Input id="email" name="email" type="email" defaultValue={initial.email} onBlur={runDupCheck} placeholder="name@company.com" />
            </Field>
            <Field label="Website" htmlFor="website" className="sm:col-span-2">
              <Input id="website" name="website" defaultValue={initial.website} placeholder="www.example.com" />
            </Field>
          </div>
          {!mustConfirm && dupBox}
        </CardBody>
      </Card>

      {isCompany && (
        <Card>
          <CardHeader title="Main contact" description="The person you usually talk to. You can add more contacts later." />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="contactName">
              <Input id="contactName" name="contactName" defaultValue={initial.contactName} />
            </Field>
            <Field label="Title" htmlFor="contactTitle">
              <Input id="contactTitle" name="contactTitle" defaultValue={initial.contactTitle} placeholder="Office Manager" />
            </Field>
            <Field label="Email" htmlFor="contactEmail">
              <Input id="contactEmail" name="contactEmail" type="email" defaultValue={initial.contactEmail} />
            </Field>
            <Field label="Phone" htmlFor="contactPhone">
              <Input id="contactPhone" name="contactPhone" type="tel" defaultValue={initial.contactPhone} />
            </Field>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Address" />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-6 gap-4">
            <Field label="Street address" htmlFor="address" className="col-span-6">
              <Input id="address" name="address" defaultValue={initial.address} />
            </Field>
            <Field label="City" htmlFor="city" className="col-span-6 sm:col-span-3">
              <Input id="city" name="city" defaultValue={initial.city} />
            </Field>
            <Field label="State" htmlFor="state" className="col-span-2 sm:col-span-1">
              <Input id="state" name="state" defaultValue={initial.state} maxLength={2} className="uppercase" />
            </Field>
            <Field label="ZIP" htmlFor="zip" className="col-span-4 sm:col-span-2">
              <Input id="zip" name="zip" defaultValue={initial.zip} inputMode="numeric" maxLength={10} />
            </Field>
          </div>
          <Checkbox name="sameBilling" label="Billing address is the same" checked={sameBilling} onChange={(e) => setSameBilling(e.target.checked)} />
          {!sameBilling && (
            <Field label="Billing address" htmlFor="billingAddress" hint="Write it the way it should appear on invoices.">
              <Textarea id="billingAddress" name="billingAddress" defaultValue={initial.billingAddress} rows={3} placeholder={"Accounts Payable\nPO Box 123\nHammond, IN 46320"} />
            </Field>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Billing & pricing" />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payment terms" htmlFor="paymentTerms">
              <Select id="paymentTerms" name="paymentTerms" defaultValue={initial.paymentTerms}>
                {(Object.keys(termsLabels) as Terms[]).map((t) => (
                  <option key={t} value={t}>
                    {termsLabels[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Customer discount" htmlFor="discountPct" hint="Percent off recommended prices. Leave 0 for none.">
              <div className="relative">
                <Input id="discountPct" name="discountPct" inputMode="decimal" defaultValue={initial.discountPercent} className="pr-8 tabular" />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">%</span>
              </div>
            </Field>
          </div>
          <div className="space-y-3">
            <Checkbox name="poRequired" defaultChecked={initial.poRequired} label="PO number required" hint="Remind us to get a purchase order number before invoicing." />
            <Checkbox name="taxExempt" checked={taxExempt} onChange={(e) => setTaxExempt(e.target.checked)} label="Tax exempt" hint="No sales tax on their quotes and invoices." />
          </div>
          {taxExempt && (
            <Field label="Exemption certificate / ID" htmlFor="taxExemptId" className="sm:max-w-sm">
              <Input id="taxExemptId" name="taxExemptId" defaultValue={initial.taxExemptId} />
            </Field>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Account" />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Salesperson" htmlFor="salespersonId">
              <Select id="salespersonId" name="salespersonId" defaultValue={initial.salespersonId}>
                <option value="">— Nobody assigned —</option>
                {salespeople.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Customer since" htmlFor="customerSince">
              <Input id="customerSince" name="customerSince" type="date" defaultValue={initial.customerSince} />
            </Field>
          </div>
          <Field label="Notes" htmlFor="notes" hint="Anything the team should know: preferences, gate codes, who approves proofs…">
            <Textarea id="notes" name="notes" defaultValue={initial.notes} rows={4} />
          </Field>
        </CardBody>
      </Card>

      {mustConfirm && dupBox}

      <div className="flex flex-wrap items-center gap-3 pb-4">
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {pending ? "Saving…" : mustConfirm ? "Save anyway" : customerId ? "Save changes" : "Save customer"}
        </Button>
        <LinkButton href={cancelHref} size="lg" variant="ghost">
          Cancel
        </LinkButton>
      </div>
    </form>
  );
}
