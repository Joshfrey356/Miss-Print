"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Paperclip, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Uploaded = { id: number; filename: string };

/**
 * Customer artwork upload (posts to /api/portal/files). With `jobId` the files go straight onto that
 * order; without, they're held for a request and their ids are handed back via `onChange`.
 */
export function PortalUploader({ jobId, label = "Upload artwork", hint = "PDF, AI, EPS, SVG, JPG, PNG… up to 50 MB each.", onChange }: { jobId?: number; label?: string; hint?: string; onChange?: (files: Uploaded[]) => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [held, setHeld] = useState<Uploaded[]>([]);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    const fd = new FormData();
    for (const f of Array.from(list)) fd.append("files", f);
    if (jobId) fd.set("jobId", String(jobId));
    try {
      const res = await fetch("/api/portal/files", { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as { files?: Uploaded[]; error?: string };
      const got = json.files ?? [];
      if (got.length && !jobId) {
        const next = [...held, ...got];
        setHeld(next);
        onChange?.(next);
      }
      if (!res.ok) throw new Error(json.error ?? "Upload failed. Please try again.");
      toast.success(got.length === 1 ? "File uploaded — thank you!" : `${got.length} files uploaded — thank you!`);
      if (jobId) router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed. Please try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const remove = (id: number) => {
    const next = held.filter((f) => f.id !== id);
    setHeld(next);
    onChange?.(next);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => !busy && input.current?.click()}
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
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
          over ? "border-brand-400 bg-brand-50" : "border-slate-300 bg-slate-50 hover:border-brand-300 hover:bg-brand-50/40",
        )}
      >
        {busy ? <Loader2 className="size-7 animate-spin text-brand-500" /> : <UploadCloud className="size-7 text-brand-500" />}
        <p className="text-[15px] font-semibold text-slate-800">{busy ? "Uploading…" : label}</p>
        <p className="text-sm text-slate-500">Tap to choose files, or drop them here. {hint}</p>
        <input ref={input} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
      </div>
      {held.length > 0 && (
        <ul className="mt-2 space-y-1">
          {held.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="flex min-w-0 items-center gap-2">
                <Paperclip className="size-4 shrink-0 text-slate-400" />
                <span className="truncate">{f.filename}</span>
              </span>
              <button type="button" onClick={() => remove(f.id)} className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label={`Remove ${f.filename}`}>
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
