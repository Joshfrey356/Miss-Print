import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { toCsv } from "@/lib/reports/csv";
import { resolveRange } from "@/lib/reports/range";
import { canSeeReport, getReportCtx, REPORTS, runReport, type ReportKey } from "@/lib/reports/registry";

/** CSV download for one report: /reports/export?report=revenue_month&range=ytd */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!can(user.role, "reports.basic")) return NextResponse.json({ error: "You don't have permission to do that." }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const key = sp.get("report") ?? "";
  if (!Object.hasOwn(REPORTS, key)) return NextResponse.json({ error: "Unknown report." }, { status: 404 });
  const ctx = await getReportCtx(user.role);
  const def = REPORTS[key as ReportKey];
  if (!canSeeReport(def, ctx)) return NextResponse.json({ error: "You don't have permission to see this report." }, { status: 403 });
  const range = resolveRange({ range: sp.get("range") ?? undefined, from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });
  const table = await runReport(key as ReportKey, range, ctx);
  const filename = `miss-print-${key.replace(/_/g, "-")}-${range.from}-to-${range.to}.csv`;
  return new NextResponse(toCsv(table), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
