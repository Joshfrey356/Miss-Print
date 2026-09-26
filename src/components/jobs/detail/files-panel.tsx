import { AlertTriangle, CheckCircle2, FileText, ImageIcon, Info } from "lucide-react";
import { FileUploader } from "@/components/file-uploader";
import { Badge } from "@/components/ui/badge";
import { FOLDER_LABELS } from "@/lib/files-shared";
import { timeAgo } from "@/lib/format";
import type { FileFolder } from "@/lib/db/schema";

export type JobFile = {
  id: number;
  folder: FileFolder;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  preflightStatus: "looks_good" | "review" | "problem" | null;
  preflight: unknown;
  createdAt: Date;
  uploadedBy: string | null;
};

const ORDER: { folder: FileFolder; hint: string; camera?: boolean }[] = [
  { folder: "original_artwork", hint: "Logos, photos and files the customer sent" },
  { folder: "working", hint: "Design working files (AI, PSD, INDD…)" },
  { folder: "production", hint: "Final print-ready files for the RIP / press" },
  { folder: "customer", hint: "Other customer documents (POs, sketches, measurements)" },
  { folder: "install_photos", hint: "Site and before/after photos", camera: true },
  { folder: "completed_photos", hint: "Finished work for the portfolio", camera: true },
];

export const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export function FilesPanel({ jobId, files, canUpload }: { jobId: number; files: JobFile[]; canUpload: boolean }) {
  return (
    <div className="space-y-6">
      {ORDER.map(({ folder, hint, camera }) => {
        const list = files.filter((f) => f.folder === folder);
        return (
          <section key={folder}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="font-semibold text-slate-800">
                {FOLDER_LABELS[folder]} <span className="font-normal text-slate-400">({list.length})</span>
              </h3>
              <span className="hidden text-xs text-slate-400 sm:block">{hint}</span>
            </div>
            {list.length > 0 && (
              <ul className="mb-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {list.map((f) => (
                  <FileRow key={f.id} f={f} />
                ))}
              </ul>
            )}
            {canUpload && <FileUploader folder={folder} jobId={jobId} compact camera={camera} label={camera ? "Add photos (camera or files)" : `Upload to ${FOLDER_LABELS[folder]}`} />}
          </section>
        );
      })}
    </div>
  );
}

export function FileRow({ f }: { f: JobFile }) {
  const isImage = f.mimeType.startsWith("image/");
  const notes = (f.preflight as { notes?: string[] } | null)?.notes ?? [];
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/files/${f.id}`} alt="" className="size-10 shrink-0 rounded border border-slate-200 bg-slate-50 object-cover" loading="lazy" />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-400">
          {f.mimeType === "application/pdf" ? <FileText className="size-5" /> : <ImageIcon className="size-5" />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="block truncate text-[15px] font-medium text-slate-800 hover:text-brand-700 hover:underline">
          {f.filename}
        </a>
        <p className="text-xs text-slate-500">
          {fmtBytes(f.sizeBytes)} · {f.uploadedBy ?? "Customer"} · {timeAgo(f.createdAt)}
        </p>
      </div>
      {f.preflightStatus && <PreflightBadge status={f.preflightStatus} notes={notes} />}
      <a href={`/api/files/${f.id}?download=1`} className="shrink-0 text-sm font-medium text-brand-600 hover:underline">
        Download
      </a>
    </li>
  );
}

function PreflightBadge({ status, notes }: { status: "looks_good" | "review" | "problem"; notes: string[] }) {
  const title = `Automatic file check (not a guarantee — a person makes the final call):\n${notes.join("\n")}`;
  if (status === "looks_good")
    return (
      <Badge tone="green" title={title}>
        <CheckCircle2 className="size-3" /> Looks good
      </Badge>
    );
  if (status === "review")
    return (
      <Badge tone="amber" title={title}>
        <Info className="size-3" /> Review
      </Badge>
    );
  return (
    <Badge tone="red" title={title}>
      <AlertTriangle className="size-3" /> Problem
    </Badge>
  );
}
