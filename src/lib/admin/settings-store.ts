import "server-only";
import { and, eq } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { companySettings } from "@/lib/db/schema";

export async function readSetting<T>(tenantId: number, key: string): Promise<T | undefined> {
  const [row] = await db
    .select({ value: companySettings.value })
    .from(companySettings)
    .where(and(eq(companySettings.tenantId, tenantId), eq(companySettings.key, key)));
  return row?.value as T | undefined;
}

/** Insert or replace one company_settings value for a shop. */
export async function saveSetting(tenantId: number, key: string, value: unknown, userId: number, tx: Tx | typeof db = db) {
  await tx
    .insert(companySettings)
    .values({ tenantId, key, value, updatedBy: userId })
    .onConflictDoUpdate({ target: [companySettings.tenantId, companySettings.key], set: { value, updatedBy: userId, updatedAt: new Date() } });
}
