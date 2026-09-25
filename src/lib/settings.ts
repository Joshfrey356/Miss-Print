import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { companySettings } from "@/lib/db/schema";
import { DEFAULT_BUSINESS_RULES, type BusinessRules } from "@/lib/pricing/engine";

export type CompanyProfile = {
  name: string;
  tagline: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  hours: string;
};

export const DEFAULT_COMPANY: CompanyProfile = {
  name: "Miss Print",
  tagline: "Print · Design · Signs",
  phone: "219-836-2517",
  email: "orders@missprintusa.com",
  website: "https://missprintusa.com",
  address: "8244 Calumet Ave, Munster, IN 46321",
  hours: "Mon–Fri 8:30–5:00 · Sat 9:00–12:00",
};

/** Optional customer-communication automations. All OFF by default (Phase 2 runs them). */
export type AutomationSettings = {
  quoteReminderDays: number | null;
  quoteFollowupDays: number | null;
  quoteAlertDays: number | null;
  proofReminderDays: number | null;
  invoiceReminderDays: number | null;
  enabled: boolean;
};
export const DEFAULT_AUTOMATIONS: AutomationSettings = {
  quoteReminderDays: 3,
  quoteFollowupDays: 7,
  quoteAlertDays: 14,
  proofReminderDays: 2,
  invoiceReminderDays: 7,
  enabled: false,
};

export const getSettings = cache(async () => {
  const rows = await db.select().from(companySettings);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    company: { ...DEFAULT_COMPANY, ...(map.company as Partial<CompanyProfile>) },
    rules: { ...DEFAULT_BUSINESS_RULES, ...(map.business_rules as Partial<BusinessRules>) },
    automations: { ...DEFAULT_AUTOMATIONS, ...(map.automations as Partial<AutomationSettings>) },
    quoteValidDays: (map.quote_valid_days as number) ?? 30,
  };
});
