import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { requirePortal } from "@/lib/portal/session";
import { getPortalSettings } from "@/lib/portal/settings";
import { getSettings } from "@/lib/settings";
import { Unavailable } from "@/components/portal/parts";
import { today } from "@/lib/format";
import { QuoteRequestForm } from "@/components/portal/request-forms";

export const metadata = { title: "Request a quote" };

export default async function PortalQuoteRequestPage() {
  const s = await requirePortal();
  const [portal, { company }] = await Promise.all([getPortalSettings(s.tenantId), getSettings(s.tenantId)]);
  if (!portal.features.quoteRequests)
    return (
      <Unavailable title="Quote requests aren't available online" phone={company.phone}>
        To ask for a price, {portal.features.messages ? <Link href="/portal/message" className="font-medium text-brand-700 hover:underline">send us a message</Link> : "please contact us"}
      </Unavailable>
    );
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Request a quote</h1>
        <p className="mt-1 text-[15px] text-slate-600">Tell us what you need and we&apos;ll send you a price. Not sure about the details? Just describe it — we&apos;ll help.</p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <QuoteRequestForm uploads={portal.features.uploads} minDate={today()} />
      </div>
      {portal.features.messages && <Link href="/portal/message" className="inline-flex items-center gap-2 text-[15px] font-medium text-brand-700 hover:underline">
        <MessageSquare className="size-4" /> Or just send us a message
      </Link>}
    </div>
  );
}
