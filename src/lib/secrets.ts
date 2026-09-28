import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption for secrets a shop connects (Stripe keys, QuickBooks tokens) before they're stored
 * in tenant_integrations.secret. AES-256-GCM with a key derived from APP_SECRET_KEY.
 *
 * APP_SECRET_KEY must be set in production and must never change afterwards (changing it makes
 * stored secrets unreadable; shops would have to reconnect). Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
export class SecretsNotConfiguredError extends Error {
  constructor() {
    super("APP_SECRET_KEY isn't set on the server, so connections can't be saved securely yet.");
  }
}

function key(): Buffer {
  const raw = process.env.APP_SECRET_KEY?.trim();
  if (raw) return createHash("sha256").update(raw).digest();
  // Local development and preview only: a fixed key, so nothing real is ever protected by it.
  if (process.env.NODE_ENV !== "production" || !process.env.DATABASE_URL) return createHash("sha256").update("dev-only-app-secret-key").digest();
  throw new SecretsNotConfiguredError();
}

/** Can secrets be stored right now? */
export function secretsConfigured() {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/** Encrypt any JSON-able value → "v1.<iv>.<tag>.<ciphertext>" (base64url). */
export function sealSecret(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** Decrypt a value from sealSecret. Throws if it was tampered with or the key changed. */
export function openSecret<T>(sealed: string): T {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognized secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plain = Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  return JSON.parse(plain) as T;
}
