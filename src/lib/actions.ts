import "server-only";
import { ForbiddenError } from "@/lib/auth";
import { ZodError } from "zod";

/** Standard result returned by every Server Action to the client. */
export type ActionResult<T = unknown> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

/**
 * Wrap Server Action bodies: turns permission/validation errors into friendly messages
 * and never leaks internal error details to the browser.
 */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (e) {
    // Let Next.js redirects / notFound propagate.
    if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_")) throw e;
    if (e instanceof ForbiddenError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error("[action error]", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Throw for problems the user can fix ("Customer is required"). Shown as-is. */
export class UserError extends Error {}

// ---- FormData helpers ----
export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};
export const int = (fd: FormData, k: string) => {
  const s = str(fd, k);
  if (s == null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
};
export const num = (fd: FormData, k: string) => {
  const s = str(fd, k);
  if (s == null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
export const bool = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v === "on" || v === "true" || v === "1";
};
