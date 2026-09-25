"use client";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "./button";

/** A submit button that shows a spinner while its form is saving. */
export function SubmitButton({ children, pendingText, variant = "primary", ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending || props.disabled} {...props}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {pending ? (pendingText ?? children) : children}
    </Button>
  );
}
