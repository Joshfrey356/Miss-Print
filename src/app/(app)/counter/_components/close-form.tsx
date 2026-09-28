"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, MoneyInput, Select, Textarea } from "@/components/ui/input";
import { centsToInput, money, parseMoney } from "@/lib/format";
import { expectedDrawer, overShort, overShortLabel } from "@/lib/counter/math";
import { cn } from "@/lib/utils";
import { closeRegisterAction } from "../actions";

/**
 * End-of-day drawer count. Expected = starting cash (float) + the day's cash payments.
 * The float is prefilled with the last close's float for the chosen location.
 */
export function CloseForm({
  date,
  cashTakenCents,
  locations,
  defaultLocationId,
  lastFloats,
}: {
  date: string;
  cashTakenCents: number;
  locations: { id: number; name: string }[];
  defaultLocationId: number | null;
  /** Last float by location id ("" = no location). */
  lastFloats: Record<string, number>;
}) {
  const router = useRouter();
  const initialLoc = locations.length === 1 ? locations[0]!.id : locations.some((l) => l.id === defaultLocationId) ? defaultLocationId : null;
  const floatFor = (loc: number | null) => centsToInput(lastFloats[String(loc ?? "")] ?? 0);
  const [locationId, setLocationId] = React.useState<number | null>(initialLoc);
  const [floatText, setFloatText] = React.useState(floatFor(initialLoc));
  const [counted, setCounted] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const floatCents = Math.max(0, parseMoney(floatText) ?? 0);
  const expected = expectedDrawer(floatCents, cashTakenCents);
  const countedCents = parseMoney(counted);
  const diff = countedCents == null ? null : overShort(countedCents, expected);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await closeRegisterAction(null, fd);
          if (!r.ok) return setError(r.error);
          setError(null);
          toast.success("Register closed");
          setCounted("");
          router.refresh();
        });
      }}
    >
      <input type="hidden" name="date" value={date} />
      {locations.length > 1 && (
        <Field label="Location" htmlFor="close-loc">
          <Select
            id="close-loc"
            name="locationId"
            value={locationId ?? ""}
            onChange={(e) => {
              const v = Number(e.target.value) || null;
              setLocationId(v);
              setFloatText(floatFor(v));
            }}
            className="h-12 text-base"
          >
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
      <Field label="Starting cash (float)" htmlFor="close-float" hint="The change fund that was in the drawer when the day started. Filled in from the last close.">
        <MoneyInput id="close-float" name="float" value={floatText} onChange={(e) => setFloatText(e.target.value)} className="h-12 text-lg" placeholder="0.00" />
      </Field>
      <div className="rounded-lg bg-slate-50 px-3 py-2 text-[15px] text-slate-700">
        {money(floatCents)} starting cash + {money(cashTakenCents)} cash taken = <strong className="text-slate-900">{money(expected)} expected</strong>
      </div>
      <Field label="Cash counted in the drawer" htmlFor="close-counted" required hint="Count everything in the drawer, starting cash included.">
        <MoneyInput id="close-counted" name="counted" value={counted} onChange={(e) => setCounted(e.target.value)} required className="h-14 text-2xl font-semibold" placeholder="0.00" />
      </Field>
      {diff !== null && (
        <div className={cn("rounded-xl px-4 py-3", diff === 0 ? "bg-emerald-50 text-emerald-800" : diff > 0 ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-800")}>
          <p className="text-sm font-medium">
            Expected {money(expected)} · counted {money(countedCents)}
          </p>
          <p className="text-3xl font-bold tabular">{overShortLabel(diff, money)}</p>
        </div>
      )}
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
