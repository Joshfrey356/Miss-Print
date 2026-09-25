"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { FileFolder } from "@/lib/db/schema";

/**
 * Drag & drop (or tap to choose) uploader. Works on phones — `capture` lets installers use the camera.
 */
export function FileUploader({
  folder,
  jobId,
  customerId,
  quoteId,
  label = "Drop files here or click to upload",
  hint,
  accept,
  camera,
  compact,
  onUploaded,
}: {
  folder: FileFolder;
  jobId?: number;
  customerId?: number;
  quoteId?: number;
  label?: string;
  hint?: string;
  accept?: string;
  camera?: boolean;
  compact?: boolean;
  onUploaded?: (files: { id: number; filename: string }[]) => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    const fd = new FormData();
    for (const f of Array.from(list)) fd.append("files", f);
    fd.set("folder", folder);
    if (jobId) fd.set("jobId", String(jobId));
    if (customerId) fd.set("customerId", String(customerId));
    if (quoteId) fd.set("quoteId", String(quoteId));
    try {
      const res = await fetch("/api/files", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      toast.success(list.length === 1 ? "File uploaded" : `${list.length} files uploaded`);
      onUploaded?.(json.files);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        upload(e.dataTransfer.files);
      }}
      className={cn(
        "flex cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed text-center transition-colors",
        compact ? "px-3 py-3" : "flex-col px-4 py-6",
        over ? "border-brand-400 bg-brand-50" : "border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50",
      )}
    >
      {busy ? <Loader2 className="size-6 animate-spin text-brand-500" /> : <UploadCloud className="size-6 text-slate-400" />}
      <div>
        <p className="text-sm font-medium text-slate-700">{busy ? "Uploading…" : label}</p>
        {hint && !compact && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={accept ?? (camera ? "image/*" : undefined)}
        capture={camera ? "environment" : undefined}
        onChange={(e) => upload(e.target.files)}
      />
    </div>
  );
}
