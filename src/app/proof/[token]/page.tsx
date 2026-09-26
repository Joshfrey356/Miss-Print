import { CheckCircle2, Clock, Lock } from "lucide-react";
import { proofByToken, proofLinkTenant } from "@/lib/proofs";
import { getSettings } from "@/lib/settings";
import { getBrand } from "@/lib/brand";
import { Logo } from "@/components/logo";
import { fmtDateTime, jobNo } from "@/lib/format";
import { ProofResponse } from "./proof-response";
import { shopName } from "./statement";

export const metadata = { title: "Proof approval", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Public page — the customer needs no account. Access is by the unguessable link token only. */
export default async function ProofPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await proofByToken(token);
  // White-label for the shop that sent the proof (an expired link still knows its shop).
  const tenantId = row ? row.proof.tenantId : await proofLinkTenant(token);
  const [settings, brand] = tenantId ? await Promise.all([getSettings(tenantId), getBrand(tenantId)]) : [null, null];
  const company = settings?.company ?? null;

  return (
    <main className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <Logo brand={brand} fallbackName="Proof approval" />
          {company && (
            <div className="text-right text-sm text-slate-500">
              <p>{company.phone}</p>
              <p>{company.email}</p>
            </div>
          )}
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-4 py-8">
        {!row ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <Clock className="mx-auto size-10 text-slate-400" />
            <h1 className="mt-3 text-xl font-semibold text-slate-900">This proof link has expired or is no longer valid.</h1>
            <p className="mt-2 text-slate-600">
              {company && (company.phone || company.email)
                ? <>Please contact {shopName(company.name)}{company.phone && <> at {company.phone}</>}{company.email && <>{company.phone ? " or email " : " at "}{company.email}</>} and we&apos;ll send you a fresh link.</>
                : <>Please contact the shop that sent it and ask for a fresh link.</>}
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              {row.customer} · {jobNo(row.job.number)}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900 sm:text-3xl">{row.job.title}</h1>
            <p className="mt-1 text-lg text-slate-600">Proof version {row.proof.version}</p>
            {row.proof.note && <p className="mt-3 rounded-lg bg-white px-4 py-3 text-[15px] text-slate-700 shadow-sm">“{row.proof.note}”</p>}

            <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {row.file.mimeType === "application/pdf" ? (
                <iframe src={`/api/proof/${token}/file`} title="Proof" className="h-[80vh] w-full" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/proof/${token}/file`} alt={`Proof V${row.proof.version}`} className="mx-auto max-h-[80vh] w-auto" />
              )}
            </div>
            <a href={`/api/proof/${token}/file`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-medium text-brand-600 hover:underline">
              Open full size
            </a>

            <div className="mt-8">
              {row.proof.status === "sent" && (
                <>
                  <p className="mb-4 text-[15px] text-slate-700">Please check everything carefully — spelling, phone numbers, colors and sizes. We print exactly what you approve.</p>
                  <ProofResponse token={token} shopName={shopName(company?.name)} />
                </>
              )}
              {row.proof.status === "approved" && (
                <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
                  <Lock className="size-6" /> Approved by {row.proof.responderName} on {fmtDateTime(row.proof.respondedAt)}. Thank you!
                </div>
              )}
              {row.proof.status === "changes_requested" && (
                <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
                  <CheckCircle2 className="size-6" /> We received your changes on {fmtDateTime(row.proof.respondedAt)}. A new proof is on the way.
                </div>
              )}
              {row.proof.status === "superseded" && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-700">A newer version of this proof has been sent to you. Please use the most recent link.</div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
