"use client";
import { useEffect } from "react";

/** Opens the print dialog once when the page is reached with ?print=1 (right after a sale). */
export function AutoPrint({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [enabled]);
  return null;
}
