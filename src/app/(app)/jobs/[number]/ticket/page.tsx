import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth";
import { getJobDetail } from "@/lib/jobs/queries";
import { getUsers } from "@/lib/lookups";
import { fmtDate, fmtDateTime, fmtSize, jobNo, parseJobNumber } from "@/lib/format";
import { getJobPrefix } from "@/lib/tenant";
import { FULFILLMENT_LABELS, PRIORITY_LABELS, STATUS_LABELS } from "@/lib/jobs/workflow";
import { PrintButton } from "@/components/print-button";
import { runInfoOf, runSteps } from "@/lib/quotes/print-options";

export const metadata = { title: "Job ticket" };

/** Printable shop ticket — specs only, never prices. */
export default async function TicketPage({ params }: { params: Promise<{ number: string }> }) {
  const user = await requirePagePermission("jobs.view");
  const number = parseJobNumber((await params).number);
  if (!number) notFound();
  const d = await getJobDetail(number, { ...user, role: "production" });
  if (!d) notFound();
  const [people, prefix] = await Promise.all([getUsers(user.tenantId), getJobPrefix(user.tenantId)]);
  const name = (id: number | null) => people.find((p) => p.id === id)?.name ?? "—";
  const { job } = d;
  const approved = d.proofs.find((p) => p.proof.status === "approved");
  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-slate-900 print:max-w-none print:p-0">
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>
      <div className="flex items-start justify-between border-b-2 border-slate-900 pb-3">
        <div>
          <p className="text-4xl font-black">{jobNo(job.number, prefix)}</p>
          <p className="mt-1 text-xl font-semibold">{job.title}</p>
          <p className="text-lg">{d.customer.name}</p>
        </div>
        <div className="text-right">
          <p className="text-sm uppercase tracking-wide text-slate-500">Due</p>
          <p className="text-2xl font-bold">{fmtDate(job.dueDate, { year: true })}</p>
          {job.priority !== "normal" && <p className="mt-1 inline-block bg-slate-900 px-2 py-0.5 text-lg font-bold uppercase text-white">{PRIORITY_LABELS[job.priority]}</p>}
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <Info label="Status" value={STATUS_LABELS[job.status]} />
        <Info label="Location" value={d.location?.name ?? "—"} />
        <Info label="Goes out by" value={`${FULFILLMENT_LABELS[job.fulfillment]}${job.fulfillmentAt ? ` · ${fmtDateTime(job.fulfillmentAt)}` : ""}`} />
        <Info label="Designer" value={name(job.designerId)} />
        <Info label="Production" value={name(job.productionId)} />
        <Info label="Installer" value={name(job.installerId)} />
        <Info label="Contact" value={[d.contact?.name, d.contact?.phone ?? d.customer.phone].filter(Boolean).join(" · ") || "—"} />
        <Info label="PO" value={job.poNumber ?? "—"} />
        <Info label="Approved proof" value={approved ? `V${approved.proof.version} (${approved.proof.responderName ?? "customer"})` : job.needsProof ? "NOT YET APPROVED" : "Not required"} />
      </dl>
      {job.siteAddress && <p className="mt-3 text-sm"><strong>Site:</strong> {job.siteAddress} {job.siteContact && `· ${job.siteContact}`}</p>}
      <table className="mt-5 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-slate-900 text-left">
            <th className="py-1.5 pr-2">Item</th>
            <th className="py-1.5 pr-2">Qty</th>
            <th className="py-1.5 pr-2">Size</th>
            <th className="py-1.5 pr-2">Material</th>
            <th className="py-1.5">Finishing</th>
          </tr>
        </thead>
        <tbody>
          {d.items.map((i) => (
            <tr key={i.id} className="border-b border-slate-300 align-top">
              <td className="py-2 pr-2">
                <p className="font-semibold">{i.description}</p>
                {i.colors && <p>Colors: {i.colors}</p>}
                {i.specs && <p className="whitespace-pre-line">{i.specs}</p>}
              </td>
              <td className="py-2 pr-2 text-base font-bold">{i.quantity.toLocaleString()}</td>
              <td className="py-2 pr-2">{fmtSize(i.widthIn, i.heightIn) || "—"}</td>
              <td className="py-2 pr-2">{i.material ?? "—"}</td>
              <td className="py-2">{i.finishing ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.items.map((i) => {
        // Only how to run it: the production info carries no prices.
        const run = runInfoOf(i.pricingBreakdown);
        if (!run) return null;
        return (
          <div key={`run-${i.id}`} className="mt-5 break-inside-avoid border-2 border-slate-900 p-3">
            <p className="text-sm font-bold uppercase tracking-wide">
              How to run it{d.items.length > 1 ? ` — ${i.description}` : ""} · {i.quantity.toLocaleString()} pcs
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {runSteps(run).map((s) => (
                <div key={s.label} className="contents">
                  <dt className="font-semibold">{s.label}</dt>
                  <dd>{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
      {job.description && <Block title="Description" text={job.description} />}
      {job.internalNotes && <Block title="Shop notes" text={job.internalNotes} />}
      <div className="mt-8 grid grid-cols-3 gap-6 text-sm">
        {["Printed", "Finished / QC", "Picked up / installed"].map((s) => (
          <div key={s} className="border-t border-slate-900 pt-1">
            {s} — initials & date
          </div>
        ))}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
function Block({ title, text }: { title: string; text: string }) {
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="whitespace-pre-line">{text}</p>
    </div>
  );
}
