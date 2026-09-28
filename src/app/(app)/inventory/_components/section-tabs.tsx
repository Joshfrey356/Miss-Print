import { LinkTabs } from "@/components/ui/tabs";

/** Inventory's sections, shown under each page's header. */
export function InventoryTabs({ active, canPurchase, counts = {} }: { active: "stock" | "pos" | "reorder" | "vendors"; canPurchase: boolean; counts?: { pos?: number; reorder?: number } }) {
  const tabs = [
    { key: "stock", label: "Stock", href: "/inventory" },
    { key: "pos", label: "Purchase orders", href: "/inventory/purchase-orders", count: counts.pos },
    { key: "reorder", label: "Suggested orders", href: "/inventory/reorder", count: counts.reorder },
    ...(canPurchase ? [{ key: "vendors", label: "Vendors", href: "/inventory/vendors" }] : []),
  ];
  return <LinkTabs tabs={tabs} active={active} />;
}
