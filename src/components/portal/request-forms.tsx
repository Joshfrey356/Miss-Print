"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sendPortalRequest } from "@/app/portal/actions";
import { PortalUploader } from "./uploader";

function Sent({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
      <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
      <p className="mt-3 text-lg font-semibold text-emerald-900">{title}</p>
      <p className="mt-1 text-emerald-800">{body}</p>
      <Link href="/portal/home" className="mt-4 inline-flex h-11 items-center rounded-lg bg-white px-4 text-[15px] font-medium text-slate-800 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50">
        Back to home
      </Link>
    </div>
  );
}

function useSubmit() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const submit = (payload: unknown) =>
    start(async () => {
      setError(null);
      const r = await sendPortalRequest(payload);
      if (!r.ok) return setError(r.error);
      setSent(true);
      router.refresh();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  return { pending, error, sent, submit };
}

const numOrNull = (s: string) => {
  const n = Number(s.replace(/[,\s]/g, ""));
  return s.trim() && Number.isFinite(n) ? Math.round(n) : NaN;
};

/** Reorder a past job: how many, when, same artwork or changes, notes, files. */
export function ReorderForm({ jobId, defaultQuantity, minDate, uploads = true }: { jobId: number; defaultQuantity: number | null; minDate: string; uploads?: boolean }) {
  const { pending, error, sent, submit } = useSubmit();
  const [quantity, setQuantity] = useState(defaultQuantity ? String(defaultQuantity) : "");
  const [neededBy, setNeededBy] = useState("");
  const [same, setSame] = useState(true);
  const [notes, setNotes] = useState("");
  const [fileIds, setFileIds] = useState<number[]>([]);
  if (sent) return <Sent title="Thank you — we got your reorder." body="We'll confirm the details and the date with you shortly." />;
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit({ kind: "reorder", jobId, quantity: numOrNull(quantity), neededBy, sameArtwork: same, notes, fileIds });
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="How many?" htmlFor="ro-qty" required>
          <Input id="ro-qty" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-12 text-base" required />
        </Field>
        <Field label="Needed by" htmlFor="ro-date" hint="Leave empty if you're flexible.">
          <Input id="ro-date" type="date" min={minDate} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} className="h-12 text-base" />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-slate-700">Artwork</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            { v: true, label: "Same as last time", hint: "No changes — print it again." },
            { v: false, label: "I have changes", hint: "Tell us what's new, or upload new files." },
          ].map((o) => (
            <label key={String(o.v)} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border-2 px-4 py-3", same === o.v ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white hover:border-slate-300")}>
              <input type="radio" name="same" checked={same === o.v} onChange={() => setSame(o.v)} className="mt-1 size-4 accent-brand-500" />
              <span>
                <span className="block text-[15px] font-medium text-slate-900">{o.label}</span>
                <span className="block text-sm text-slate-500">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={same ? "Anything else? (optional)" : "What should we change?"} htmlFor="ro-notes" required={!same}>
        <Textarea id="ro-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={same ? "Deliver to our new address, split into two boxes…" : "New phone number, updated logo…"} />
      </Field>
      {!same && uploads && <PortalUploader label="Upload new artwork (optional)" onChange={(f) => setFileIds(f.map((x) => x.id))} />}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <Button type="submit" variant="primary" size="lg" className="w-full sm:w-auto" disabled={pending || (!same && !notes.trim() && fileIds.length === 0)}>
        {pending && <Loader2 className="size-4 animate-spin" />} Send reorder
      </Button>
      <p className="text-sm text-slate-500">We&apos;ll confirm the price and date before we start. Nothing is charged yet.</p>
    </form>
  );
}

/** Request a quote for something new. */
export function QuoteRequestForm({ minDate, uploads = true }: { minDate: string; uploads?: boolean }) {
  const { pending, error, sent, submit } = useSubmit();
  const [f, setF] = useState({ what: "", quantity: "", size: "", neededBy: "", notes: "" });
  const [fileIds, setFileIds] = useState<number[]>([]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  if (sent) return <Sent title="Thank you — we got your request." body="We'll send you a quote soon. You'll find it under Quotes." />;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit({ kind: "quote", ...f, fileIds });
      }}
    >
      <Field label="What do you need?" htmlFor="rq-what" required>
        <Input id="rq-what" value={f.what} onChange={set("what")} placeholder="Business cards, yard signs, a vehicle wrap…" className="h-12 text-base" required />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="How many?" htmlFor="rq-qty">
          <Input id="rq-qty" value={f.quantity} onChange={set("quantity")} placeholder="500" className="h-12 text-base" />
        </Field>
        <Field label="Size" htmlFor="rq-size">
          <Input id="rq-size" value={f.size} onChange={set("size")} placeholder='3.5" × 2"' className="h-12 text-base" />
        </Field>
        <Field label="Needed by" htmlFor="rq-date">
          <Input id="rq-date" type="date" min={minDate} value={f.neededBy} onChange={set("neededBy")} className="h-12 text-base" />
        </Field>
      </div>
      <Field label="Details" htmlFor="rq-notes">
        <Textarea id="rq-notes" rows={4} value={f.notes} onChange={set("notes")} placeholder="Paper or material, colors, one or two sides, where it goes…" />
      </Field>
      {uploads && <PortalUploader label="Add artwork or examples (optional)" onChange={(x) => setFileIds(x.map((y) => y.id))} />}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <Button type="submit" variant="primary" size="lg" className="w-full sm:w-auto" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />} Request a quote
      </Button>
    </form>
  );
}

/** Message the shop, optionally about one order. */
export function MessageForm({ jobs, defaultJobId, uploads = true }: { jobs: { id: number; label: string }[]; defaultJobId: number | null; uploads?: boolean }) {
  const { pending, error, sent, submit } = useSubmit();
  const [jobId, setJobId] = useState<string>(defaultJobId ? String(defaultJobId) : "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [fileIds, setFileIds] = useState<number[]>([]);
  if (sent) return <Sent title="Message sent." body="Thanks — we'll get back to you soon." />;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit({ kind: "message", subject, body, jobId: jobId ? Number(jobId) : null, fileIds });
      }}
    >
      {jobs.length > 0 && (
        <Field label="About an order? (optional)" htmlFor="m-job">
          <Select id="m-job" value={jobId} onChange={(e) => setJobId(e.target.value)} className="h-12 text-base">
            <option value="">No — something else</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Subject" htmlFor="m-subject" required>
        <Input id="m-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="h-12 text-base" required />
      </Field>
      <Field label="Message" htmlFor="m-body" required>
        <Textarea id="m-body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} required />
      </Field>
      {uploads && <PortalUploader label="Attach files (optional)" onChange={(x) => setFileIds(x.map((y) => y.id))} />}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <Button type="submit" variant="primary" size="lg" className="w-full sm:w-auto" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />} Send message
      </Button>
    </form>
  );
}
