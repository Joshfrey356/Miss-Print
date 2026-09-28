"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, MoneyInput, Select, Textarea } from "@/components/ui/input";
import { money, parseMoney } from "@/lib/format";
import { overShort, overShortLabel } from "@/lib/counter/math";
import { cn } from "@/lib/utils";
import { closeRegisterAction } from "../actions";

export function CloseForm({ date, expectedCents, locations, defaultLocationId }: { date: string; expectedCents: number; locations: { id: number; name: string }[]; defaultLocationId: number | null }) {
  const router = useRouter();
  const [counted, setCounted] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const countedCents = parseMoney(counted);
  const diff = countedCents == null ? null : overShort(countedCents, expectedCents);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        start(async () => {
          const r = await closeRegisterAction(null, fd);
          if (!r.ok) return setError(r.error);
          setError(null);
          toast.success("Register closed");
          form.reset();
          setCounted("");
          router.refresh();
        });
      }}
    >
      <input type="hidden" name="date" value={date} />
      <Field label="Cash counted in the drawer" htmlFor="close-counted" required hint="Count the cash from today's sales (leave out the starting float / change fund).">
        <MoneyInput id="close-counted" name="counted" value={counted} onChange={(e) => setCounted(e.target.value)} required className="h-14 text-2xl font-semibold" placeholder="0.00" />
      </Field>
      {diff !== null && (
        <div className={cn("rounded-xl px-4 py-3", diff === 0 ? "bg-emerald-50 text-emerald-800" : diff > 0 ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-800")}>
          <p className="text-sm font-medium">Expected {money(expectedCents)} · counted {money(countedCents)}</p>
          <p className="text-3xl font-bold tabular">{overShortLabel(diff, money)}</p>
        </div>
      )}
      {locations.length > 1 && (
        <Field label="Location" htmlFor="close-loc">
          <Select id="close-loc" name="locationId" defaultValue={defaultLocationId ?? ""} className="h-12 text-base">
            <option value="">—</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {locations.length === 1 && <input type="hidden" name="locationId" value={locations[0]!.id} />}
      <Field label="Notes" htmlFor="close-notes">
        <Textarea id="close-notes" name="notes" rows={2} maxLength={2000} placeholder="e.g. $5 short — refund given from the drawer" />
      </Field>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[15px] font-medium text-red-700">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" className="h-14 w-full text-lg" disabled={pending || countedCents == null}>
        {pending && <Loader2 className="size-5 animate-spin" />}
        Close the register
      </Button>
    </form>
  );
}
