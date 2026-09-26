import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { StorageClient } from "@supabase/storage-js";

/**
 * File storage abstraction. Swap drivers with STORAGE_DRIVER without touching app code.
 * Files are NEVER served directly — always through /api/files/[id] after a permission check.
 */
export interface StorageProvider {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

class LocalStorage implements StorageProvider {
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data, { flag: "wx" }); // never overwrite
  }
  async get(key: string) {
    try {
      return await readFile(this.resolve(key));
    } catch (e) {
      // Preview mode: demo placeholder files ship in preview/storage.
      if (!process.env.DATABASE_URL) return readFile(path.join(process.cwd(), "preview/storage", path.normalize(key).replace(/^(\.\.[/\\])+/, "")));
      throw e;
    }
  }
  async exists(key: string) {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Supabase Storage. Uses a PRIVATE bucket and the server-only secret (service role) key;
 * files still only reach the browser through the permission-checked /api routes.
 * The bucket is created automatically (private) on first upload if it doesn't exist.
 */
class SupabaseStorage implements StorageProvider {
  private client: StorageClient;
  private bucketReady: Promise<void> | null = null;
  constructor(url: string, key: string, private bucket: string) {
    this.client = new StorageClient(`${url.replace(/\/+$/, "")}/storage/v1`, { apikey: key, Authorization: `Bearer ${key}` });
  }
  private ensureBucket() {
    this.bucketReady ??= (async () => {
      const { error } = await this.client.getBucket(this.bucket);
      if (!error) return;
      const created = await this.client.createBucket(this.bucket, { public: false, fileSizeLimit: MAX_UPLOAD_BYTES });
      if (created.error && !/already exists/i.test(created.error.message)) throw new Error(`Storage bucket "${this.bucket}": ${created.error.message}`);
    })().catch((e) => {
      this.bucketReady = null; // retry next time
      throw e;
    });
    return this.bucketReady;
  }
  private files() {
    return this.client.from(this.bucket);
  }
  async put(key: string, data: Buffer, contentType: string) {
    await this.ensureBucket();
    const { error } = await this.files().upload(key, data, { contentType: contentType || "application/octet-stream", upsert: false }); // never overwrite
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
  }
  async get(key: string) {
    const { data, error } = await this.files().download(key);
    if (error || !data) {
      // Records imported from preview/demo data point at placeholder files that ship with the app.
      try {
        return await readFile(path.join(process.cwd(), "preview/storage", path.normalize(key).replace(/^(\.\.[/\\])+/, "")));
      } catch {
        throw new Error(`Storage download failed: ${error?.message ?? "not found"}`);
      }
    }
    return Buffer.from(await data.arrayBuffer());
  }
  async exists(key: string) {
    const { data } = await this.files().exists(key);
    return Boolean(data);
  }
}

/** Which storage driver is active: explicit STORAGE_DRIVER, else Supabase when its keys are set, else local disk. */
export function storageDriverName(): "local" | "supabase" {
  const explicit = process.env.STORAGE_DRIVER?.trim().toLowerCase();
  if (explicit === "supabase" || explicit === "local") return explicit;
  if (explicit) throw new Error(`Storage driver "${explicit}" is not supported. Use STORAGE_DRIVER=supabase or local.`);
  return process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "local";
}

let instance: StorageProvider | null = null;
export function storage(): StorageProvider {
  if (instance) return instance;
  const driver = storageDriverName();
  if (driver === "supabase") {
    const url = process.env.SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) throw new Error("STORAGE_DRIVER=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    instance = new SupabaseStorage(url, key, process.env.STORAGE_BUCKET?.trim() || "miss-print-files");
    return instance;
  }
  // Preview mode (no DATABASE_URL) writes to /tmp, the only writable place on serverless hosts.
  const dir = process.env.STORAGE_LOCAL_DIR ?? (process.env.DATABASE_URL ? "./storage" : "/tmp/miss-print-storage");
  instance = new LocalStorage(path.resolve(dir));
  return instance;
}

/** Random, unguessable key that keeps the extension. */
export function newStorageKey(filename: string) {
  const ext = path.extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 10);
  const d = new Date();
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${randomBytes(16).toString("hex")}${ext}`;
}

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Very basic, honest file check. A person makes the final production decision. */
export function basicPreflight(filename: string, mime: string, size: number) {
  const ext = path.extname(filename).toLowerCase();
  const printReady = [".pdf", ".ai", ".eps", ".svg", ".tif", ".tiff", ".psd"];
  const raster = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic"];
  const notes: string[] = [];
  let status: "looks_good" | "review" | "problem" = "looks_good";
  if (printReady.includes(ext)) notes.push("Print-ready format.");
  else if (raster.includes(ext)) {
    status = "review";
    notes.push("Image file — check resolution for the printed size.");
    if (size < 300 * 1024) notes.push("Small file size; may be low resolution.");
  } else if ([".doc", ".docx", ".ppt", ".pptx", ".pub", ".xls", ".xlsx"].includes(ext)) {
    status = "review";
    notes.push("Office document — usually needs to be converted or rebuilt.");
  } else if (![".zip", ".cdr", ".indd", ".txt", ".csv"].includes(ext)) {
    status = "problem";
    notes.push("Unrecognized file type.");
  }
  return { status, notes, mime };
}
