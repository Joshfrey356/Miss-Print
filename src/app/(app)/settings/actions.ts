"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { runAction, str, UserError, type ActionResult } from "@/lib/actions";
import { db } from "@/lib/db";
import { locations } from "@/lib/db/schema";
import { diff, logActivity } from "@/lib/activity";
import { getSettings, type AutomationSettings, type CompanyProfile } from "@/lib/settings";
import { saveSetting } from "@/lib/admin/settings-store";
import { parseMoney } from "@/lib/format";
import type { BusinessRules } from "@/lib/pricing/engine";

type Prev = ActionResult | null;

/** "25" → 0.25. Blank → null. */
function pctField(fd: FormData, k: string): number | null {
  const s = str(fd, k);
  if (s == null) return null;
  const n = Number(s.replace(/[%,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 10000 : NaN;
}
function moneyField(fd: FormData, k: string): number | null {
  const s = str(fd, k);
  if (s == null) return null;
  const c = parseMoney(s);
  return c == null ? NaN : c;
}

const money = (label: string) =>
  z
    .number({ error: (iss) => (iss.input == null ? `Enter the ${label.toLowerCase()}.` : `${label} must be a dollar amount.`) })
    .int()
    .min(0, `${label} can't be negative.`)
    .max(100_000_00, `${label} looks too large.`);
const pctOf = (label: string, max: number) =>
  z
    .number({ error: (iss) => (iss.input == null ? `Enter the ${label.toLowerCase()}.` : `${label} must be a number.`) })
    .min(0, `${label} can't be negative.`)
    .max(max, `${label} can't be more than ${Math.round(max * 100)}%.`);

const rulesSchema = z.object({
  minimumChargeCents: money("Minimum charge"),
  designRateCents: money("Design rate"),
  installRateCents: money("Install rate"),
  laborCostPerHourCents: money("Labor cost per hour"),
  mileageRateCents: money("Mileage rate"),
  rushPct: pctOf("Rush fee", 3),
  targetMarginPct: pctOf("Target margin", 0.95),
  outsourcedMarkupPct: pctOf("Outside-services markup", 5),
  taxRate: pctOf("Sales tax rate", 0.25),
});

export async function saveBusinessRules(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("settings.manage");
    const next: BusinessRules = rulesSchema.parse({
      minimumChargeCents: moneyField(fd, "minimumCharge"),
      designRateCents: moneyField(fd, "designRate"),
      installRateCents: moneyField(fd, "installRate"),
      laborCostPerHourCents: moneyField(fd, "laborCost"),
      mileageRateCents: moneyField(fd, "mileageRate"),
      rushPct: pctField(fd, "rushPct"),
      targetMarginPct: pctField(fd, "targetMarginPct"),
      outsourcedMarkupPct: pctField(fd, "outsourcedMarkupPct"),
      taxRate: pctField(fd, "taxRate"),
    });
    const validDaysRaw = str(fd, "quoteValidDays");
    const quoteValidDays = z.coerce
      .number({ error: "Enter how many days a quote is good for." })
      .int("Quote days must be a whole number.")
      .min(1, "A quote must be good for at least 1 day.")
      .max(365, "Quote days can't be more than 365.")
      .parse(validDaysRaw ?? "");

    const current = await getSettings();
    const changes = diff({ ...current.rules, quoteValidDays: current.quoteValidDays }, { ...next, quoteValidDays });
    if (!changes) return;
    await db.transaction(async (tx) => {
      await saveSetting("business_rules", next, user.id, tx);
      await saveSetting("quote_valid_days", quoteValidDays, user.id, tx);
      await logActivity(
        { action: "setting.updated", entityType: "setting", actorId: user.id, summary: "Updated business rules", data: { key: "business_rules", ...changes } },
        tx,
      );
    });
    revalidatePath("/", "layout");
  }, "Business rules saved");
}

const companySchema = z.object({
  name: z.string().min(1, "Enter the company name.").max(120),
  tagline: z.string().max(200),
  phone: z.string().max(40),
  email: z.union([z.literal(""), z.email("Enter a valid email address.")]),
  website: z.string().max(200),
  address: z.string().max(300),
  hours: z.string().max(300),
});

export async function saveCompanyProfile(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("settings.manage");
    const next: CompanyProfile = companySchema.parse(
      Object.fromEntries(["name", "tagline", "phone", "email", "website", "address", "hours"].map((k) => [k, str(fd, k) ?? ""])),
    );
    const { company } = await getSettings();
    const changes = diff(company, next);
    if (!changes) return;
    await db.transaction(async (tx) => {
      await saveSetting("company", next, user.id, tx);
      await logActivity(
        { action: "setting.updated", entityType: "setting", actorId: user.id, summary: "Updated company profile", data: { key: "company", ...changes } },
        tx,
      );
    });
    revalidatePath("/", "layout");
  }, "Company profile saved");
}

const locationSchema = z.object({
  id: z.coerce.number().int().positive(),
  name: z.string().min(1, "Enter the location name.").max(80),
  role: z.string().max(200),
  address: z.string().max(300).nullable(),
  phone: z.string().max(40).nullable(),
});

export async function saveLocation(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("settings.manage");
    const next = locationSchema.parse({
      id: str(fd, "id"),
      name: str(fd, "name") ?? "",
      role: str(fd, "role") ?? "",
      address: str(fd, "address"),
      phone: str(fd, "phone"),
    });
    const [before] = await db.select().from(locations).where(eq(locations.id, next.id));
    if (!before) throw new UserError("That location no longer exists.");
    const { id, ...fields } = next;
    const changes = diff(before, fields);
    if (!changes) return;
    await db.transaction(async (tx) => {
      await tx.update(locations).set(fields).where(eq(locations.id, id));
      await logActivity(
        {
          action: "setting.updated",
          entityType: "setting",
          entityId: id,
          actorId: user.id,
          summary: `Updated location ${fields.name}`,
          data: { key: "location", ...changes },
        },
        tx,
      );
    });
    revalidatePath("/", "layout");
  }, "Location saved");
}

const daysSchema = z.number().int().min(1, "Days must be at least 1.").max(365, "Days can't be more than 365.").nullable();

export async function saveAutomations(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("settings.manage");
    const days = (k: keyof AutomationSettings) => {
      if (fd.get(`${k}On`) !== "on") return null;
      const s = str(fd, k);
      if (s == null) throw new UserError("Enter the number of days for each reminder you turned on.");
      return daysSchema.parse(Number(s));
    };
    const next: AutomationSettings = {
      enabled: fd.get("enabled") === "on",
      quoteReminderDays: days("quoteReminderDays"),
      quoteFollowupDays: days("quoteFollowupDays"),
      quoteAlertDays: days("quoteAlertDays"),
      proofReminderDays: days("proofReminderDays"),
      invoiceReminderDays: days("invoiceReminderDays"),
    };
    const { automations } = await getSettings();
    const changes = diff(automations, next);
    if (!changes) return;
    await db.transaction(async (tx) => {
      await saveSetting("automations", next, user.id, tx);
      await logActivity(
        { action: "setting.updated", entityType: "setting", actorId: user.id, summary: "Updated customer message automations", data: { key: "automations", ...changes } },
        tx,
      );
    });
    revalidatePath("/settings/automations");
  }, "Automation settings saved");
}
