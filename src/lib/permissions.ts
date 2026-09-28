import type { Role } from "@/lib/db/schema";

/**
 * Everything a user can do is expressed as a permission.
 * Checked on the SERVER for every page, action and API route.
 */
export const PERMISSIONS = [
  "dashboard.company", // company-wide dashboard (not just "my work")
  "financials.view", // prices, totals on jobs/quotes
  "margins.view", // cost, margin, profit
  "customers.view",
  "customers.edit",
  "quotes.view",
  "quotes.edit",
  "jobs.view",
  "jobs.edit", // edit job details, assignments, dates
  "jobs.status", // move jobs through the workflow
  "jobs.create",
  "files.upload",
  "proofs.send",
  "messages.use",
  "tasks.use",
  "calendar.view",
  "calendar.edit",
  "money.view", // Money section: invoices, payments, AR
  "money.edit", // create invoices, record payments
  "money.void", // void invoices/payments
  "counter.use", // front counter: ring up walk-in sales and take payments
  "inventory.view", // stock levels, reservations, movements
  "inventory.edit", // receive deliveries, record usage, adjust and count stock
  "purchasing.edit", // create, send and receive purchase orders (shows costs)
  "schedule.edit", // book jobs on machines in the equipment schedule
  "expenses.edit",
  "reports.basic",
  "reports.financial",
  "pricing.edit",
  "settings.manage",
  "users.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);

const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  owner: ALL,
  manager: new Set<Permission>([
    "dashboard.company",
    "financials.view",
    "customers.view",
    "customers.edit",
    "quotes.view",
    "quotes.edit",
    "jobs.view",
    "jobs.edit",
    "jobs.status",
    "jobs.create",
    "files.upload",
    "proofs.send",
    "messages.use",
    "tasks.use",
    "calendar.view",
    "calendar.edit",
    "expenses.edit",
    "reports.basic",
    "counter.use",
    "inventory.view",
    "inventory.edit",
    "purchasing.edit",
    "schedule.edit",
  ]),
  sales: new Set<Permission>([
    "financials.view",
    "customers.view",
    "customers.edit",
    "quotes.view",
    "quotes.edit",
    "jobs.view",
    "jobs.edit",
    "jobs.status",
    "jobs.create",
    "files.upload",
    "proofs.send",
    "messages.use",
    "tasks.use",
    "calendar.view",
    "calendar.edit",
    "counter.use",
  ]),
  designer: new Set<Permission>([
    "customers.view",
    "jobs.view",
    "jobs.status",
    "files.upload",
    "proofs.send",
    "messages.use",
    "tasks.use",
    "calendar.view",
  ]),
  production: new Set<Permission>(["jobs.view", "jobs.status", "files.upload", "messages.use", "tasks.use", "calendar.view", "inventory.view", "inventory.edit", "schedule.edit"]),
  installer: new Set<Permission>(["jobs.view", "jobs.status", "files.upload", "messages.use", "tasks.use", "calendar.view"]),
  accounting: new Set<Permission>([
    "dashboard.company",
    "financials.view",
    "margins.view",
    "customers.view",
    "jobs.view",
    "quotes.view",
    "messages.use",
    "tasks.use",
    "calendar.view",
    "money.view",
    "money.edit",
    "money.void",
    "expenses.edit",
    "reports.basic",
    "reports.financial",
    "counter.use",
    "inventory.view",
    "purchasing.edit",
  ]),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner / Admin",
  manager: "Manager",
  sales: "Sales / Front Counter",
  designer: "Designer",
  production: "Production",
  installer: "Installer",
  accounting: "Accounting",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Everything, including money, margins, pricing rules, team and settings.",
  manager: "Jobs, customers, quotes, production, schedule, messages and basic reports.",
  sales: "Customers, quotes, orders, artwork uploads, job status and communication.",
  designer: "Design queue, files, proofs, revisions, deadlines and messages.",
  production: "Jobs ready for production, specs, files, deadlines and priorities.",
  installer: "Installation jobs, addresses, contacts, schedule and photos.",
  accounting: "Invoices, payments, expenses, balances and reports.",
};
