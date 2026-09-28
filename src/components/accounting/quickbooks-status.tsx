import { AlertCircle, CheckCircle2, CircleDashed, Clock, Info } from "lucide-react";
import { getCurrentUser, userCan } from "@/lib/auth";
import { qboAppLink } from "@/lib/accounting/quickbooks/config";
import { getQboStatuses, type QboBadgeStatus } from "@/lib/accounting/quickbooks/server";
import type { SyncEntityType } from "@/lib/accounting/quickbooks/status";
import { Badge } from "@/components/ui/badge";
import { QuickBooksRetry } from "./quickbooks-retry";

/**
 * Small "is this in QuickBooks?" badge for an invoice, payment or customer:
 *   In QuickBooks (✓ icon) · In QuickBooks — check total · Sending… · Not synced · Not sent (why) · Sync failed — Retry
 * Renders nothing when the shop hasn't connected QuickBooks.
 *
 *   <QuickBooksStatus tenantId={user.tenantId} entityType="invoice" entityId={inv.id} />
 * In lists, fetch once with getQboStatuses(tenantId, type, ids) and pass `status` to avoid a query per row.
 */
export async function QuickBooksStatus({
  tenantId,
  entityType,
  entityId,
  status,
}: {
  tenantId: number;
  entityType: SyncEntityType;
  entityId: number;
  status?: QboBadgeStatus;
}) {
  const s = status !== undefined ? status : ((await getQboStatuses(tenantId, entityType, [entityId])).get(entityId) ?? null);
  if (!s) return null;

  switch (s.state) {
    case "synced":
    case "warning": {
      const warn = s.state === "warning";
      const badge = (
        <Badge tone={warn ? "amber" : "green"} title={warn ? (s.error ?? undefined) : "This record is in QuickBooks"}>
          {warn ? <Info className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
          {warn ? "In QuickBooks — check total" : "In QuickBooks"}
        </Badge>
      );
      return s.externalId ? (
        <a href={qboAppLink(s.environment, entityType, s.externalId)} target="_blank" rel="noopener noreferrer" className="inline-flex hover:opacity-80">
          {badge}
        </a>
      ) : (
        badge
      );
    }
    case "failed": {
      const user = await getCurrentUser();
      const canRetry = !!user && user.tenantId === tenantId && (userCan(user, "money.edit") || userCan(user, "settings.manage"));
      return (
        <span className="inline-flex flex-wrap items-center gap-1" title={s.error ?? undefined}>
          <Badge tone="red">
            <AlertCircle className="size-3.5" />
            Sync failed
          </Badge>
          {canRetry && <QuickBooksRetry type={entityType} id={entityId} />}
        </span>
      );
    }
    case "pending":
      return (
        <Badge tone="gray" title="Waiting to be sent to QuickBooks">
          <Clock className="size-3.5" />
          Sending to QuickBooks…
        </Badge>
      );
    case "skipped":
      return (
        <Badge tone="gray" title={s.error ?? undefined}>
          <CircleDashed className="size-3.5" />
          Not sent to QuickBooks
        </Badge>
      );
    default:
      return (
        <Badge tone="gray" title="Not in QuickBooks yet">
          <CircleDashed className="size-3.5" />
          Not synced
        </Badge>
      );
  }
}
