"use client";
import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";

type Success = { ok: true; message?: string; data?: unknown };
type Result = Success | { ok: false; error: string };

const CONFIRM = "CONFIRM:";
const Pending = React.createContext(false);

/**
 * A form posting to a Server Action (prev, formData). Shows the error inline (keeping what was typed),
 * and when the server asks for a double-check ("CONFIRM:…", e.g. a suspiciously big number) shows the
 * question with a "Yes, that's right" button that sends the same form again with confirmed=1.
 */
export function StockForm({
  action,
  children,
  className,
  successMessage = "Saved",
  onSuccess,
  resetOnSuccess,
}: {
  action: (prev: null, fd: FormData) => Promise<Result>;
  children: React.ReactNode;
  className?: string;
  successMessage?: string;
  onSuccess?: (r: Success) => void;
  resetOnSuccess?: boolean;
}) {
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [question, setQuestion] = React.useState<string | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  const submit = (confirmed: boolean) => {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    if (confirmed) fd.set("confirmed", "1");
    start(async () => {
      const r = await action(null, fd);
      if (r.ok) {
        setError(null);
        setQuestion(null);
        toast.success(r.message ?? successMessage);
        if (resetOnSuccess) form.reset();
        onSuccess?.(r);
      } else if (r.error.startsWith(CONFIRM)) {
        setError(null);
        setQuestion(r.error.slice(CONFIRM.length));
      } else {
        setQuestion(null);
        setError(r.error);
      }
    });
  };

  return (
    <form
      ref={formRef}
      className={className}
      onChange={() => question && setQuestion(null)}
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <Pending.Provider value={pending}>{children}</Pending.Provider>
      {question && (
        <div role="alert" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[15px] text-amber-900">
          <p className="flex items-start gap-2 font-medium">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {question}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" size="sm" disabled={pending} onClick={() => submit(true)}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Yes, that&apos;s right
            </Button>
            <Button size="sm" onClick={() => setQuestion(null)}>
              Let me fix it
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[15px] font-medium text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}

/** Submit button for <StockForm>: spinner while saving. */
export function StockSubmit({ children, pendingText = "Saving…", variant = "primary", ...props }: ButtonProps & { pendingText?: string }) {
  const pending = React.useContext(Pending);
  return (
    <Button type="submit" variant={variant} disabled={pending || props.disabled} {...props}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {pending ? pendingText : children}
    </Button>
  );
}
