"use client";
import * as React from "react";
import * as M from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const Dropdown = M.Root;
export const DropdownTrigger = M.Trigger;

export function DropdownContent({ className, align = "end", ...props }: M.DropdownMenuContentProps) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 min-w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg", className)}
        {...props}
      />
    </M.Portal>
  );
}

export function DropdownItem({ className, ...props }: M.DropdownMenuItemProps) {
  return (
    <M.Item
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[15px] text-slate-700 outline-none data-[highlighted]:bg-slate-100 data-[highlighted]:text-slate-900",
        className,
      )}
      {...props}
    />
  );
}

export const DropdownSeparator = () => <M.Separator className="my-1 h-px bg-slate-100" />;
export const DropdownLabel = ({ children }: { children: React.ReactNode }) => (
  <M.Label className="px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">{children}</M.Label>
);
