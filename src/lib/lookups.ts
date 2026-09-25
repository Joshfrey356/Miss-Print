import "server-only";
import { cache } from "react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { locations, materials, productCategories, users } from "@/lib/db/schema";

/** Small reference lists used by forms & filters (cached per request). */
export const getUsers = cache(() =>
  db
    .select({ id: users.id, name: users.name, handle: users.handle, role: users.role, color: users.color, active: users.active, locationId: users.locationId })
    .from(users)
    .orderBy(asc(users.name)),
);
export const getActiveUsers = cache(async () => (await getUsers()).filter((u) => u.active));

export const getLocations = cache(() => db.select().from(locations).orderBy(asc(locations.sortOrder)));

export const getCategories = cache(() =>
  db.select().from(productCategories).where(eq(productCategories.active, true)).orderBy(asc(productCategories.sortOrder)),
);

export const getMaterials = cache(() => db.select().from(materials).where(eq(materials.active, true)).orderBy(asc(materials.name)));
