import type { ReportTable } from "./registry";

const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Spreadsheet-friendly CSV: money in dollars, percentages as numbers, dates as YYYY-MM-DD. */
export function toCsv(t: ReportTable): string {
  const header = t.columns.map((c) => esc(c.kind === "money" ? `${c.label} ($)` : c.kind === "pct" ? `${c.label} (%)` : c.label));
  const lines = t.rows.map((r) =>
    t.columns
      .map((c) => {
        const v = r[c.key];
        if (v == null) return "";
        if (typeof v === "number") {
          if (c.kind === "money") return (v / 100).toFixed(2);
          if (c.kind === "pct") return (v * 100).toFixed(1);
          if (c.kind === "days") return v.toFixed(1);
          return String(v);
        }
        // Stop spreadsheet formula injection from customer-entered text.
        return esc(/^[=+\-@]/.test(v) ? `'${v}` : v);
      })
      .join(","),
  );
  return "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
}
