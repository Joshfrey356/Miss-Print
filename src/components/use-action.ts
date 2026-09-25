"use client";
import { useTransition } from "react";
import { toast } from "sonner";

type Result = { ok: true; message?: string; data?: unknown } | { ok: false; error: string };

/**
 * Run a Server Action from a button/handler with pending state and a short toast.
 *   const [pending, run] = useServerAction();
 *   run(() => markDone(id), { success: "Marked done" })
 */
export function useServerAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, opts: { success?: string; onSuccess?: (r: Result & { ok: true }) => void } = {}) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error);
      else {
        if (opts.success ?? r.message) toast.success(opts.success ?? r.message);
        opts.onSuccess?.(r);
      }
    });
  return [pending, run] as const;
}
