"use client";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

const Pending = React.createContext(false);

/**
 * A form that posts to a Server Action (prev, formData) => ActionResult,
 * shows a short toast when it saves, and the error inline when it doesn't.
 * Uses onSubmit (not <form action>) so a failed save never wipes what the person typed.
 */
export function ActionForm({
  action,
  children,
  className,
  successMessage = "Saved",
  onSuccess,
  resetOnSuccess,
}: {
  action: (prev: Result, fd: FormData) => Promise<Result>;
  children: React.ReactNode;
  className?: string;
  successMessage?: string;
  onSuccess?: () => void;
  resetOnSuccess?: boolean;
}) {
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        start(async () => {
          const r = await action(null, fd);
          if (!r) return;
          if (r.ok) {
            setError(null);
            toast.success(r.message ?? successMessage);
            if (resetOnSuccess) form.reset();
            onSuccess?.();
          } else setError(r.error);
        });
      }}
    >
      <Pending.Provider value={pending}>{children}</Pending.Provider>
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[15px] font-medium text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}

/** Submit button for <ActionForm>: shows a spinner while saving. */
export function SaveButton({ children, pendingText = "Saving…", variant = "primary", ...props }: ButtonProps & { pendingText?: string }) {
  const pending = React.useContext(Pending);
  return (
    <Button type="submit" variant={variant} disabled={pending || props.disabled} {...props}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {pending ? pendingText : children}
    </Button>
  );
}
