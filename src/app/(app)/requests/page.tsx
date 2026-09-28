import Link from "next/link";
import { Inbox, MessageSquare, RotateCcw, FileText } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { getPortalRequestCounts, listPortalRequests, type RequestTab } from "@/lib/portal/staff";
import { REQUEST_KIND_LABELS } from "@/lib/portal/rules";
import { getJobPrefix } from "@/lib/tenant";
import { jobNo, timeAgo } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Chips } from "@/components/chips";

export const metadata = { title: "Customer requests" };

const ICON = { reorder: RotateCcw, quote: FileText, message: MessageSquare } as const;

/** Staff inbox: reorders, quote requests and messages customers sent from the customer portal. */
export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePagePermission("customers.view");
  const tab: RequestTab = (await searchParams).tab === "handled" ? "handled" : "new";
  const [rows, counts, prefix] = await Promise.all([listPortalRequests(user.tenantId, tab), getPortalRequestCounts(user.tenantId), getJobPrefix(user.tenantId)]);
  return (
    <>
      <PageHeader title="Customer requests" subtitle="Reorders, quote requests and messages from the customer portal." />
      <div className="mb-4">
        <Chips
          active={tab}
          items={[
            { key: "new", label: "New", count: counts.new, tone: "red", href: "/requests" },
            { key: "handled", label: "Handled", href: "/requests?tab=handled" },
          ]}
        />
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={Inbox} title={tab === "new" ? "No new requests from customers." : "No handled requests yet."} description={tab === "new" ? "When customers reorder, ask for a quote or send a message in the portal, it shows up here." : undefined} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              const Icon = ICON[r.kind];
              return (
                <li key={r.id}>
                  <Link href={`/requests/${r.id}`} className="flex items-start gap-3 px-5 py-4 hover:bg-slate-50">
                    <span className="mt-0.5 rounded-lg bg-slate-100 p-2 text-slate-500">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[15px] font-medium text-slate-900">{r.subject}</p>
                        <Badge tone={r.kind === "reorder" ? "violet" : r.kind === "quote" ? "blue" : "gray"}>{REQUEST_KIND_LABELS[r.kind]}</Badge>
                      </div>
                      <p className="mt-0.5 text-sm text-slate-600">
                        {r.customerName}
                        {r.fromName && r.fromName !== r.customerName ? ` · ${r.fromName}` : ""}
                        {r.jobNumber ? ` · ${jobNo(r.jobNumber, prefix)}` : ""}
                      </p>
                      {r.body && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{r.body}</p>}
                    </div>
                    <span className="shrink-0 text-sm text-slate-500">{timeAgo(tab === "handled" && r.handledAt ? r.handledAt : r.createdAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
