import { AlertTriangle, CheckCircle2, CircleSlash, TrendingDown } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { PO_STATUS_LABELS, STOCK_STATUS_LABELS, type PoStatus, type StockStatus } from "@/lib/inventory/math";

const STOCK_TONE: Record<StockStatus, Tone> = { ok: "green", low: "amber", out: "red", short: "red" };
const STOCK_ICON = { ok: CheckCircle2, low: TrendingDown, out: CircleSlash, short: AlertTriangle } as const;

export function StockStatusBadge({ status, className }: { status: StockStatus; className?: string }) {
  const Icon = STOCK_ICON[status];
  return (
    <Badge tone={STOCK_TONE[status]} className={className}>
      <Icon className="size-3" />
      {STOCK_STATUS_LABELS[status]}
    </Badge>
  );
}

const PO_TONE: Record<PoStatus, Tone> = { draft: "gray", ordered: "blue", partial: "amber", received: "green", cancelled: "red" };

export function PoStatusBadge({ status, late }: { status: PoStatus; late?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={PO_TONE[status]}>{PO_STATUS_LABELS[status]}</Badge>
      {late && (
        <Badge tone="red">
          <AlertTriangle className="size-3" />
          Late
        </Badge>
      )}
    </span>
  );
}
