/**
 * Department channels and @group mentions. Pure data — safe on client and server.
 */
import type { Role } from "@/lib/db/schema";

export type Channel = { key: string; label: string; description: string; roles?: Role[] };

export const CHANNELS: Channel[] = [
  { key: "general", label: "General", description: "Shop-wide news and announcements" },
  { key: "front_counter", label: "Front Counter", description: "Walk-ins, phone calls and customer questions" },
  { key: "design", label: "Design", description: "Artwork, proofs and design questions" },
  { key: "production", label: "Production", description: "Printing, finishing, materials and equipment" },
  { key: "installations", label: "Installations", description: "Installs, site visits and the van" },
  { key: "management", label: "Management", description: "Owner and managers only", roles: ["owner", "manager"] },
];

export const getChannel = (key: string | null | undefined) => CHANNELS.find((c) => c.key === key) ?? null;

export const canSeeChannel = (role: Role, key: string) => {
  const ch = getChannel(key);
  return Boolean(ch && (!ch.roles || ch.roles.includes(role)));
};

export const visibleChannels = (role: Role) => CHANNELS.filter((c) => !c.roles || c.roles.includes(role));

/** "@production" notifies everyone with that role. */
export const MENTION_GROUPS: { handle: string; label: string; roles: Role[] }[] = [
  { handle: "production", label: "Production team", roles: ["production"] },
  { handle: "design", label: "Designers", roles: ["designer"] },
  { handle: "installers", label: "Installers", roles: ["installer"] },
  { handle: "front", label: "Front counter", roles: ["sales"] },
  { handle: "managers", label: "Owner & managers", roles: ["owner", "manager"] },
];

/** Same pattern as parseMentions() in lib/notifications, for highlighting on screen. */
export const MENTION_RE = /(^|[^\w@])@([a-z][\w.-]{1,30})/gi;

/** "@mike." → "mike" (trailing punctuation isn't part of a handle). */
export const cleanHandle = (h: string) => h.toLowerCase().replace(/[.-]+$/, "");
