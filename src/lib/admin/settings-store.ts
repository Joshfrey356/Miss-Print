import "server-only";
import { eq } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { companySettings } from "@/lib/db/schema";

export async function readSetting<T>(key: string): Promise<T | undefined> {
  const [row] = await db.select({ value: companySettings.value }).from(companySettings).where(eq(companySettings.key, key));
  return row?.value as T | undefined;
}

/** Insert or replace one company_settings value. */
export async function saveSetting(key: string, value: unknown, userId: number, tx: Tx | typeof db = db) {
  await tx
    .insert(companySettings)
    .values({ key, value, updatedBy: userId })
    .onConflictDoUpdate({ target: companySettings.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
}
