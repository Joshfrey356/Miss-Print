"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { diff, logActivity } from "@/lib/activity";
import { saveSetting } from "@/lib/admin/settings-store";
import { MAX_WELCOME, PORTAL_FEATURES, type PortalSettings } from "@/lib/portal/config";
import { getPortalSettings } from "@/lib/portal/settings";

/** Settings → Customer Portal: on/off, welcome message and which features customers may use. */
export async function savePortalSettings(_prev: unknown, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("settings.manage");
    const welcome = String(fd.get("welcome") ?? "").trim();
    if (welcome.length > MAX_WELCOME) throw new UserError(`Keep the welcome message under ${MAX_WELCOME} characters.`);
    const next: PortalSettings = {
      enabled: fd.get("enabled") === "on",
      welcome,
      features: Object.fromEntries(PORTAL_FEATURES.map((f) => [f.key, fd.get(`f_${f.key}`) === "on"])) as PortalSettings["features"],
    };
    const before = await getPortalSettings(user.tenantId);
    const flat = (s: PortalSettings) => ({ enabled: s.enabled, welcome: s.welcome, ...Object.fromEntries(Object.entries(s.features).map(([k, v]) => [`feature.${k}`, v])) });
    const changes = diff(flat(before), flat(next));
    if (!changes) return;
    await db.transaction(async (tx) => {
      await saveSetting(user.tenantId, "portal", next, user.id, tx);
      const summary =
        before.enabled !== next.enabled ? (next.enabled ? "Turned the customer portal on" : "Turned the customer portal off") : "Updated customer portal settings";
      await logActivity({ tenantId: user.tenantId, action: "setting.updated", entityType: "setting", actorId: user.id, summary, data: { key: "portal", ...changes } }, tx);
    });
    revalidatePath("/settings/portal");
  }, "Customer portal settings saved");
}
