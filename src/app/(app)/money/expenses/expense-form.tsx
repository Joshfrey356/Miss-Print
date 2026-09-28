"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useJobNo } from "@/components/shop-context";
import { Camera, Loader2, Paperclip, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Field, Input, MoneyInput, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ExpenseCategory } from "@/lib/db/schema";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, EXPENSE_PAYMENT_METHODS } from "@/lib/money/labels";
import { archiveExpenseAction, createExpenseAction, updateExpenseAction } from "../actions";

export type ExpenseFormValues = {
  vendor: string;
  amount: string;
  category: ExpenseCategory | "";
  spentOn: string;
  job: string;
  paymentMethod: string;
  notes: string;
  receipt?: { id: number; name: string } | null;
};

export function ExpenseForm({
  mode,
  expenseId,
  initial,
  vendors,
  backToJob,
  cancelHref,
  maxDate,
}: {
  mode: "new" | "edit";
  expenseId?: number;
  initial: ExpenseFormValues;
  vendors: { name: string; category: ExpenseCategory | null }[];
  backToJob?: boolean;
  cancelHref: string;
  maxDate: string;
}) {
  const router = useRouter();
  const jobNo = useJobNo();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [pending, start] = React.useTransition();
  const [category, setCategory] = React.useState<string>(initial.category);
  const [categoryTouched, setCategoryTouched] = React.useState(mode === "edit");
  const [method, setMethod] = React.useState(initial.paymentMethod);
  const [file, setFile] = React.useState<File | null>(null);
  const [removeReceipt, setRemoveReceipt] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const vendorMap = React.useMemo(() => new Map(vendors.map((v) => [v.name.toLowerCase(), v])), [vendors]);

  function onVendor(v: string) {
    const hit = vendorMap.get(v.trim().toLowerCase());
    if (hit?.category && !categoryTouched) setCategory(hit.category);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const another = submitter?.value === "another";
    const fd = new FormData(e.currentTarget);
    fd.delete("receipt");
    if (file) fd.set("receipt", file);
    if (removeReceipt) fd.set("removeReceipt", "1");
    setError(null);
    start(async () => {
      const r = mode === "edit" && expenseId ? await updateExpenseAction(expenseId, fd) : await createExpenseAction(fd);
      if (!r.ok) {
        setError(r.error);
        toast.error(r.error);
        return;
      }
      toast.success(r.message ?? "Saved");
      if (another) {
        formRef.current?.reset();
        setFile(null);
        setCategory("");
        setCategoryTouched(false);
        setMethod(initial.paymentMethod);
        formRef.current?.querySelector<HTMLInputElement>("input[name=vendor]")?.focus();
        return;
      }
      if (r.data?.redirectTo) router.push(r.data.redirectTo);
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-5">
      {backToJob && <input type="hidden" name="back" value="job" />}
      <datalist id="vendor-list">
        {vendors.map((v) => (
          <option key={v.name} value={v.name} />
        ))}
      </datalist>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Vendor" required htmlFor="exp-vendor">
          <Input
            id="exp-vendor"
            name="vendor"
            list="vendor-list"
            defaultValue={initial.vendor}
            required
            maxLength={200}
            autoComplete="off"
            autoFocus={mode === "new"}
            placeholder="Who did you pay?"
            onChange={(e) => onVendor(e.target.value)}
            className="h-12 text-base"
          />
        </Field>
        <Field label="Amount" required htmlFor="exp-amount">
          <MoneyInput id="exp-amount" name="amount" defaultValue={initial.amount} required placeholder="0.00" className="h-12 text-lg font-medium" />
        </Field>
        <Field label="Category" required htmlFor="exp-category">
          <Select
            id="exp-category"
            name="category"
            required
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setCategoryTouched(true);
            }}
            className="h-12 text-base"
          >
            <option value="" disabled>
              Choose…
            </option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EXPENSE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" required htmlFor="exp-date">
          <Input id="exp-date" name="spentOn" type="date" defaultValue={initial.spentOn} max={maxDate} required className="h-12 text-base" />
        </Field>
        <Field label="Job number" htmlFor="exp-job" hint="Optional. Add it when this was bought for a specific job, so job costs are right.">
          <Input id="exp-job" name="job" defaultValue={initial.job} placeholder={jobNo(10428)} inputMode="text" autoComplete="off" maxLength={20} className="h-12 text-base uppercase placeholder:normal-case" />
        </Field>
        <Field label="Paid with">
          <div className="grid grid-cols-5 gap-1.5">
            {EXPENSE_PAYMENT_METHODS.map((m) => (
              <label
                key={m}
                className={cn(
                  "flex h-12 cursor-pointer items-center justify-center rounded-lg border px-1 text-center text-sm font-medium",
                  method === m ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                )}
              >
                <input type="radio" name="paymentMethod" value={m} checked={method === m} onChange={() => setMethod(m)} onClick={() => method === m && setMethod("")} className="sr-only" />
                {m}
              </label>
            ))}
          </div>
        </Field>
      </div>

      <Field label="Notes" htmlFor="exp-notes">
        <Textarea id="exp-notes" name="notes" rows={2} defaultValue={initial.notes} maxLength={2000} placeholder="What was it for? (optional)" />
      </Field>

      <Field label="Receipt" hint="Photo or PDF. Optional.">
        <input
          ref={fileInput}
          type="file"
          name="receipt"
          accept="image/*,application/pdf"
          className="sr-only"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setRemoveReceipt(false);
          }}
        />
        {file ? (
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
            <Paperclip className="size-4 text-slate-500" />
            <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{file.name}</span>
            <button
              type="button"
              className="rounded p-1 text-slate-400 hover:text-slate-700"
              aria-label="Remove file"
              onClick={() => {
                setFile(null);
                if (fileInput.current) fileInput.current.value = "";
              }}
            >
              <X className="size-4" />
            </button>
          </div>
        ) : initial.receipt && !removeReceipt ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
            <Paperclip className="size-4 text-slate-500" />
            <a href={`/api/files/${initial.receipt.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium text-brand-700 hover:underline">
              {initial.receipt.name}
            </a>
            <button type="button" className="text-sm font-medium text-slate-600 hover:text-slate-900" onClick={() => fileInput.current?.click()}>
              Replace
            </button>
            <button type="button" className="text-sm font-medium text-red-700 hover:text-red-800" onClick={() => setRemoveReceipt(true)}>
              Remove
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 px-4 py-5 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
          >
            <Camera className="size-5 text-slate-400" />
            Take a photo or choose a file
            {removeReceipt && <span className="text-xs font-normal text-slate-500">(current receipt will be removed)</span>}
          </button>
        )}
      </Field>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

      <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-5 sm:flex-row sm:items-center">
        {mode === "edit" && expenseId && <ArchiveButton id={expenseId} />}
        <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row">
          <Button type="button" size="lg" variant="ghost" onClick={() => router.push(cancelHref)}>
            Cancel
          </Button>
          {mode === "new" && (
            <Button type="submit" size="lg" value="another" disabled={pending}>
              Save & add another
            </Button>
          )}
          <Button type="submit" size="lg" variant="primary" value="save" disabled={pending} className="sm:min-w-40">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {mode === "edit" ? "Save changes" : "Save expense"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function ArchiveButton({ id }: { id: number }) {
  const router = useRouter();
  return (
    <Confirm
      title="Remove this expense?"
      description="It will no longer count toward totals or job costs. It stays in the records as archived."
      confirmLabel="Remove expense"
      onConfirm={async () => {
        const r = await archiveExpenseAction(id);
        if (!r.ok) toast.error(r.error);
        else {
          toast.success(r.message ?? "Removed");
          router.push(r.data?.redirectTo ?? "/money?tab=expenses");
        }
      }}
    >
      <Button type="button" size="lg" variant="ghost" className="text-red-700 hover:bg-red-50">
        <Trash2 className="size-4" />
        Remove expense
      </Button>
    </Confirm>
  );
}
