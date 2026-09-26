"use client";
import { useRef, useState, useTransition } from "react";
import { Loader2, NotebookPen, PhoneCall } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { logCommunication } from "../actions";

/** "Log a call / note" — records a phone call or internal note on the customer's timeline. */
export function CommForm({ customerId }: { customerId: number }) {
  const [channel, setChannel] = useState<"phone" | "note">("phone");
  const [direction, setDirection] = useState<"inbound" | "outbound">("inbound");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLFormElement>(null);

  const pill = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium",
      active ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900",
    );

  return (
    <form
      ref={ref}
      className="space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("channel", channel);
        fd.set("direction", direction);
        setError(null);
        start(async () => {
          const r = await logCommunication(customerId, fd);
          if (!r.ok) setError(r.error);
          else {
            toast.success(channel === "phone" ? "Call logged" : "Note saved");
            ref.current?.reset();
          }
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg bg-slate-100 p-1">
          <button type="button" className={pill(channel === "phone")} onClick={() => setChannel("phone")} aria-pressed={channel === "phone"}>
            <PhoneCall className="size-4" /> Phone call
          </button>
          <button type="button" className={pill(channel === "note")} onClick={() => setChannel("note")} aria-pressed={channel === "note"}>
            <NotebookPen className="size-4" /> Note
          </button>
        </div>
        {channel === "phone" && (
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            <button type="button" className={pill(direction === "inbound")} onClick={() => setDirection("inbound")} aria-pressed={direction === "inbound"}>
              They called us
            </button>
            <button type="button" className={pill(direction === "outbound")} onClick={() => setDirection("outbound")} aria-pressed={direction === "outbound"}>
              We called them
            </button>
          </div>
        )}
      </div>
      <Textarea
        name="body"
        rows={3}
        aria-label={channel === "phone" ? "What was the call about?" : "Note"}
        placeholder={channel === "phone" ? "What was the call about? e.g. Asked for a rush on the banners, will pick up Friday." : "Write a note for the team…"}
      />
      {error && <p className="text-sm font-medium text-red-700">{error}</p>}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        {channel === "phone" ? "Log call" : "Save note"}
      </Button>
    </form>
  );
}
