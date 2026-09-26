/** Shapes shared by the chat UI (client) and message queries (server). */
import type { Role } from "@/lib/db/schema";

export type ChatMessage = {
  id: number;
  body: string;
  important: boolean;
  createdAt: Date;
  editedAt: Date | null;
  author: { id: number; name: string; handle: string; color: string };
  file: { id: number; filename: string; mimeType: string } | null;
};

/** People who can be @mentioned. `getActiveUsers()` from lib/lookups fits as-is. */
export type ChatUser = { id: number; name: string; handle: string; color?: string | null; role?: Role; active?: boolean };
