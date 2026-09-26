import "server-only";
import { cache } from "react";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { locations, materials, productCategories, users } from "@/lib/db/schema";

/** Small reference lists for one shop, used by forms & filters (cached per request). */
export const getUsers = cache((tenantId: number) =>
  db
    .select({ id: users.id, name: users.name, handle: users.handle, role: users.role, color: users.color, active: users.active, locationId: users.locationId })
    .from(users)
    .where(eq(users.tenantId, tenantId))
    .orderBy(asc(users.name)),
);
export const getActiveUsers = cache(async (tenantId: number) => (await getUsers(tenantId)).filter((u) => u.active));

export const getLocations = cache((tenantId: number) =>
  db.select().from(locations).where(eq(locations.tenantId, tenantId)).orderBy(asc(locations.sortOrder), asc(locations.id)),
);

export const getCategories = cache((tenantId: number) =>
  db
    .select()
    .from(productCategories)
    .where(and(eq(productCategories.tenantId, tenantId), eq(productCategories.active, true)))
    .orderBy(asc(productCategories.sortOrder)),
);

export const getMaterials = cache((tenantId: number) =>
  db
    .select()
    .from(materials)
    .where(and(eq(materials.tenantId, tenantId), eq(materials.active, true)))
    .orderBy(asc(materials.name)),
);
