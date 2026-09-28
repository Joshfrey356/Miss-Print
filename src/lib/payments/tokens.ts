import "server-only";
import { openSecret, sealSecret } from "@/lib/secrets";

/**
 * Public "pay online" links carry a sealed token (AES-GCM with APP_SECRET_KEY), so they can't be
 * guessed or altered and need no extra table:
 *   /pay/invoice/<token>  → pay an invoice's current balance (used in emails; never expires)
 *   /pay/l/<token>        → a specific Stripe Checkout link (short URL for the counter QR code)
 */
type PayToken = { k: "i" | "l"; t: number; id: number };

export function payToken(kind: "invoice" | "link", tenantId: number, id: number) {
  return sealSecret({ k: kind === "invoice" ? "i" : "l", t: tenantId, id } satisfies PayToken);
}

export function readPayToken(token: string, kind: "invoice" | "link"): { tenantId: number; id: number } | null {
  if (!/^v1\.[A-Za-z0-9_.-]{20,400}$/.test(token)) return null;
  try {
    const v = openSecret<PayToken>(token);
    if (v.k !== (kind === "invoice" ? "i" : "l") || !Number.isInteger(v.t) || !Number.isInteger(v.id)) return null;
    return { tenantId: v.t, id: v.id };
  } catch {
    return null;
  }
}
