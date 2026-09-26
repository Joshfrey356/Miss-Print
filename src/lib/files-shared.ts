// Client-safe file constants.
import type { FileFolder } from "@/lib/db/schema";

export const FOLDER_LABELS: Record<FileFolder, string> = {
  customer: "Customer Files",
  original_artwork: "Original Artwork",
  working: "Working Files",
  proof: "Proofs",
  production: "Production Files",
  install_photos: "Installation Photos",
  completed_photos: "Completed Photos",
  receipt: "Receipts",
  other: "Other",
};
