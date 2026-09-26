import type { Role } from "@/lib/db/schema";
import { can } from "@/lib/permissions";

/** Owner and managers (settings.manage or dashboard.company) can write and archive knowledge articles. Everyone can read. */
export const canEditKnowledge = (role: Role) => can(role, "settings.manage") || can(role, "dashboard.company");
