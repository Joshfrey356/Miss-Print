"use client";
import Link from "next/link";
import { BookOpen, LogOut, Settings, SlidersHorizontal, Tv, UserCog } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { logoutAction } from "@/app/(auth)/login/actions";

export function UserMenu({ name, color, roleLabel, isAdmin }: { name: string; color: string; roleLabel: string; isAdmin: boolean }) {
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-100">
          <Avatar name={name} color={color} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-slate-800">{name}</span>
            <span className="block truncate text-xs text-slate-500">{roleLabel}</span>
          </span>
        </button>
      </DropdownTrigger>
      <DropdownContent align="start" side="top">
        <DropdownLabel>{name}</DropdownLabel>
        <DropdownItem asChild>
          <Link href="/settings/profile">
            <SlidersHorizontal className="size-4 text-slate-400" /> My profile & notifications
          </Link>
        </DropdownItem>
        <DropdownItem asChild>
          <Link href="/knowledge">
            <BookOpen className="size-4 text-slate-400" /> Knowledge
          </Link>
        </DropdownItem>
        <DropdownItem asChild>
          <Link href="/tv" target="_blank">
            <Tv className="size-4 text-slate-400" /> Production TV mode
          </Link>
        </DropdownItem>
        {isAdmin && (
          <>
            <DropdownSeparator />
            <DropdownItem asChild>
              <Link href="/settings">
                <Settings className="size-4 text-slate-400" /> Settings & business rules
              </Link>
            </DropdownItem>
            <DropdownItem asChild>
              <Link href="/settings/team">
                <UserCog className="size-4 text-slate-400" /> Team & permissions
              </Link>
            </DropdownItem>
          </>
        )}
        <DropdownSeparator />
        <DropdownItem onSelect={() => logoutAction()}>
          <LogOut className="size-4 text-slate-400" /> Sign out
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}
