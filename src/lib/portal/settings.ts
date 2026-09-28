import "server-only";
import { cache } from "react";
import { readSetting } from "@/lib/admin/settings-store";
import { UserError } from "@/lib/actions";
import { normalizePortalSettings, portalAllows, type PortalFeature, type PortalSettings } from "./config";

/** A shop's customer portal settings, with defaults (portal on, everything allowed). Cached per request. */
export const getPortalSettings = cache(async (tenantId: number): Promise<PortalSettings> => normalizePortalSettings(await readSetting(tenantId, "portal")));

/** For portal actions: refuse when the shop turned this feature (or the portal) off. */
export async function requirePortalFeature(tenantId: number, feature: PortalFeature) {
  if (!portalAllows(await getPortalSettings(tenantId), feature)) throw new UserError("That isn't available in the portal. Please contact us instead.");
}
