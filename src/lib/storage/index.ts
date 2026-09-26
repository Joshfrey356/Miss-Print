import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

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
    return readFile(this.resolve(key));
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

// Future: SupabaseStorage / S3Storage implementing the same interface.

let instance: StorageProvider | null = null;
export function storage(): StorageProvider {
  if (instance) return instance;
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver === "local") instance = new LocalStorage(path.resolve(process.env.STORAGE_LOCAL_DIR ?? "./storage"));
  else throw new Error(`Storage driver "${driver}" is not implemented yet. Use STORAGE_DRIVER=local.`);
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
