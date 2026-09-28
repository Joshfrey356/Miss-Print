"use server";
import { revalidatePath } from "next/cache";
import { and, eq, max } from "drizzle-orm";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { runAction, str, UserError, type ActionResult } from "@/lib/actions";
import { db } from "@/lib/db";
import { locations, tenants } from "@/lib/db/schema";
import { diff, logActivity } from "@/lib/activity";
import { getSettings, type AutomationSettings, type CompanyProfile } from "@/lib/settings";
import { saveSetting } from "@/lib/admin/settings-store";
import { normalizeJobPrefix, parseMoney } from "@/lib/format";
import { getTenant } from "@/lib/tenant";
import { newStorageKey, storage } from "@/lib/storage";
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

    const current = await getSettings(user.tenantId);
    const changes = diff({ ...current.rules, quoteValidDays: current.quoteValidDays }, { ...next, quoteValidDays });
    if (!changes) return;
    await db.transaction(async (tx) => {
      await saveSetting(user.tenantId, "business_rules", next, user.id, tx);
      await saveSetting(user.tenantId, "quote_valid_days", quoteValidDays, user.id, tx);
      await logActivity(
        { tenantId: user.tenantId, action: "setting.updated", entityType: "setting", actorId: user.id, summary: "Updated business rules", data: { key: "business_rules", ...changes } },
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
    const [{ company }, tenant] = await Promise.all([getSettings(user.tenantId), getTenant(user.tenantId)]);
    const oldPrefix = tenant?.jobPrefix ?? "J";
    // Job number prefix (MP → MP-10428). Only the letters shown change; job numbers stay the same.
    const rawPrefix = str(fd, "jobPrefix");
    const jobPrefix = rawPrefix == null ? oldPrefix : normalizeJobPrefix(rawPrefix);
    if (!jobPrefix) throw new UserError("Use 1–5 letters for the job number prefix, like MP.");
    const changes = diff(company, next);
    const prefixChanged = jobPrefix !== oldPrefix;
    if (!changes && !prefixChanged) return;
    await db.transaction(async (tx) => {
      if (changes) {
        // The name is the shop's white-label brand (sidebar, sign-in page, proofs, emails).
        if (next.name !== company.name) await tx.update(tenants).set({ name: next.name }).where(eq(tenants.id, user.tenantId));
        await saveSetting(user.tenantId, "company", next, user.id, tx);
        await logActivity(
          { tenantId: user.tenantId, action: "setting.updated", entityType: "setting", actorId: user.id, summary: "Updated company profile", data: { key: "company", ...changes } },
          tx,
        );
      }
      if (prefixChanged) {
        await tx.update(tenants).set({ jobPrefix }).where(eq(tenants.id, user.tenantId));
        await logActivity(
          {
            tenantId: user.tenantId,
            action: "setting.updated",
            entityType: "setting",
            actorId: user.id,
            summary: `Changed the job number prefix from ${oldPrefix} to ${jobPrefix}`,
            data: { key: "jobPrefix", before: { jobPrefix: oldPrefix }, after: { jobPrefix } },
          },
          tx,
        );
      }
    });
    revalidatePath("/", "layout");
  }, "Company profile saved");
}

const LOGO_TYPES: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg" };
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** Upload the shop's logo (white-label). Replaces the current one; old files are kept, never overwritten. */
export async function uploadCompanyLogo(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("settings.manage");
    const file = fd.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new UserError("Choose a logo image to upload.");
    const ext = LOGO_TYPES[file.type];
    if (!ext) throw new UserError("Use a PNG, JPG, WebP, GIF or SVG image for the logo.");
    if (file.size > MAX_LOGO_BYTES) throw new UserError("The logo must be smaller than 2 MB.");
    const key = newStorageKey(user.tenantId, `logo${ext}`);
    await storage().put(key, Buffer.from(await file.arrayBuffer()), file.type);
    await db.transaction(async (tx) => {
      await tx.update(tenants).set({ logoStorageKey: key, logoMimeType: file.type, logoUpdatedAt: new Date() }).where(eq(tenants.id, user.tenantId));
      await logActivity({ tenantId: user.tenantId, action: "setting.updated", entityType: "setting", actorId: user.id, summary: "Uploaded a new company logo", data: { key: "logo" } }, tx);
    });
    revalidatePath("/", "layout");
  }, "Logo saved");
}

/** Go back to showing the company name as the logo. */
export async function removeCompanyLogo(): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("settings.manage");
    await db.transaction(async (tx) => {
      await tx.update(tenants).set({ logoStorageKey: null, logoMimeType: null, logoUpdatedAt: new Date() }).where(eq(tenants.id, user.tenantId));
      await logActivity({ tenantId: user.tenantId, action: "setting.updated", entityType: "setting", actorId: user.id, summary: "Removed the company logo", data: { key: "logo" } }, tx);
    });
    revalidatePath("/", "layout");
  }, "Logo removed");
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
    const [before] = await db.select().from(locations).where(and(eq(locations.tenantId, user.tenantId), eq(locations.id, next.id)));
    if (!before) throw new UserError("That location no longer exists.");
    const { id, ...fields } = next;
    const changes = diff(before, fields);
    if (!changes) return;
    await db.transaction(async (tx) => {
      await tx.update(locations).set(fields).where(and(eq(locations.tenantId, user.tenantId), eq(locations.id, id)));
      await logActivity(
        {
          tenantId: user.tenantId,
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

const newLocationSchema = z.object({
  name: z.string().min(1, "Enter the location name.").max(80),
  role: z.string().max(200),
  address: z.string().max(300).nullable(),
  phone: z.string().max(40).nullable(),
  isCustomerFacing: z.boolean(),
});

/** Add a location (e.g. a second shop or a production building). */
export async function addLocation(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("settings.manage");
    const next = newLocationSchema.parse({
      name: str(fd, "name") ?? "",
      role: str(fd, "role") ?? "",
      address: str(fd, "address"),
      phone: str(fd, "phone"),
      isCustomerFacing: fd.get("isCustomerFacing") === "on",
    });
    await db.transaction(async (tx) => {
      const existing = await tx.select({ code: locations.code, name: locations.name }).from(locations).where(eq(locations.tenantId, user.tenantId));
      if (existing.some((l) => l.name.toLowerCase() === next.name.toLowerCase())) throw new UserError(`There's already a location called ${next.name}.`);
      // Short internal code: "North Side" → NORTH_SIDE (unique within this shop).
      const base = next.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20) || "LOCATION";
      const codes = new Set(existing.map((l) => l.code));
      let code = base;
      for (let i = 2; codes.has(code); i++) code = `${base}_${i}`;
      const [{ last }] = await tx.select({ last: max(locations.sortOrder) }).from(locations).where(eq(locations.tenantId, user.tenantId));
      const [row] = await tx
        .insert(locations)
        .values({ tenantId: user.tenantId, code, ...next, role: next.role, sortOrder: (last ?? 0) + 1 })
        .returning({ id: locations.id });
      await logActivity(
        { tenantId: user.tenantId, action: "setting.updated", entityType: "setting", entityId: row!.id, actorId: user.id, summary: `Added location ${next.name}`, data: { key: "location", after: next } },
        tx,
      );
    });
    revalidatePath("/", "layout");
  }, "Location added");
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
    const { automations } = await getSettings(user.tenantId);
    const changes = diff(automations, next);
    if (!changes) return;
    await db.transaction(async (tx) => {
      await saveSetting(user.tenantId, "automations", next, user.id, tx);
      await logActivity(
        { tenantId: user.tenantId, action: "setting.updated", entityType: "setting", actorId: user.id, summary: "Updated customer message automations", data: { key: "automations", ...changes } },
        tx,
      );
    });
    revalidatePath("/settings/automations");
  }, "Automation settings saved");
}
