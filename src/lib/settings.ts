import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { eq } from "drizzle-orm";
import { companySettings } from "@/lib/db/schema";
import { getTenant } from "@/lib/tenant";
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

/** A shop's company profile before they fill it in (the name always comes from the shop itself). */
export const DEFAULT_COMPANY: CompanyProfile = { name: "", tagline: "", phone: "", email: "", website: "", address: "", hours: "" };

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

/** One shop's settings. The company name always comes from the shop itself (tenants.name). */
export const getSettings = cache(async (tenantId: number) => {
  const [rows, tenant] = await Promise.all([db.select().from(companySettings).where(eq(companySettings.tenantId, tenantId)), getTenant(tenantId)]);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    company: { ...DEFAULT_COMPANY, ...(map.company as Partial<CompanyProfile>), ...(tenant ? { name: tenant.name } : {}) },
    rules: { ...DEFAULT_BUSINESS_RULES, ...(map.business_rules as Partial<BusinessRules>) },
    automations: { ...DEFAULT_AUTOMATIONS, ...(map.automations as Partial<AutomationSettings>) },
    quoteValidDays: (map.quote_valid_days as number) ?? 30,
  };
});
