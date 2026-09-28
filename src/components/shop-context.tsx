"use client";
import * as React from "react";
import { jobNo } from "@/lib/format";

/** Per-shop display settings for client components (provided by the signed-in app layout). */
export type ShopDisplay = { jobPrefix: string };

const ShopContext = React.createContext<ShopDisplay>({ jobPrefix: "J" });

export function ShopProvider({ value, children }: { value: ShopDisplay; children: React.ReactNode }) {
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export const useShop = () => React.useContext(ShopContext);

/** Format job numbers with this shop's prefix: const jobNo = useJobNo(); jobNo(10428) → "MP-10428". */
export function useJobNo() {
  const { jobPrefix } = useShop();
  return React.useCallback((n: number) => jobNo(n, jobPrefix), [jobPrefix]);
}
