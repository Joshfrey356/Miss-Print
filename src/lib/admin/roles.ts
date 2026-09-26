/**
 * Plain-English view of the permission matrix for Settings → Team.
 * Reads permissions.ts; never changes it. Safe on client and server.
 */
import type { Role } from "@/lib/db/schema";
import { can, PERMISSIONS, ROLE_DESCRIPTIONS, ROLE_LABELS, type Permission } from "@/lib/permissions";

export const ROLES = Object.keys(ROLE_LABELS) as Role[];

/** What each permission means, in words an owner would use. Grouped for the table. */
export const PERMISSION_INFO: { group: string; items: { key: Permission; label: string }[] }[] = [
  {
    group: "Jobs & work",
    items: [
      { key: "dashboard.company", label: "See the whole-company dashboard" },
      { key: "jobs.view", label: "See jobs" },
      { key: "jobs.create", label: "Create jobs" },
      { key: "jobs.edit", label: "Edit job details, dates and assignments" },
      { key: "jobs.status", label: "Move jobs to the next step" },
      { key: "files.upload", label: "Upload files and artwork" },
      { key: "proofs.send", label: "Send proofs to customers" },
      { key: "calendar.view", label: "See the calendar" },
      { key: "calendar.edit", label: "Add and change calendar entries" },
      { key: "messages.use", label: "Use messages and job chat" },
      { key: "tasks.use", label: "Use tasks" },
    ],
  },
  {
    group: "Customers & quotes",
    items: [
      { key: "customers.view", label: "See customers" },
      { key: "customers.edit", label: "Add and edit customers" },
      { key: "quotes.view", label: "See quotes" },
      { key: "quotes.edit", label: "Create and edit quotes" },
    ],
  },
  {
    group: "Money",
    items: [
      { key: "financials.view", label: "See prices and totals" },
      { key: "margins.view", label: "See costs, margins and profit" },
      { key: "money.view", label: "See invoices, payments and balances" },
      { key: "money.edit", label: "Create invoices and record payments" },
      { key: "money.void", label: "Void invoices and payments" },
      { key: "expenses.edit", label: "Enter expenses" },
    ],
  },
  {
    group: "Reports & admin",
    items: [
      { key: "reports.basic", label: "See operations and sales reports" },
      { key: "reports.financial", label: "See revenue and money reports" },
      { key: "pricing.edit", label: "Change pricing rules" },
      { key: "settings.manage", label: "Change business rules and settings" },
      { key: "users.manage", label: "Add and manage team members" },
    ],
  },
];

export function permissionsForRole(role: Role): Permission[] {
  return PERMISSIONS.filter((p) => can(role, p));
}

export function roleMatrix() {
  return ROLES.map((role) => ({
    role,
    label: ROLE_LABELS[role],
    description: ROLE_DESCRIPTIONS[role],
    permissions: permissionsForRole(role),
  }));
}
