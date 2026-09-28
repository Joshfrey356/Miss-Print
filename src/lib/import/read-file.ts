/**
 * Read an uploaded spreadsheet IN THE BROWSER (so big files never hit upload limits):
 * CSV/TSV/TXT with papaparse, Excel .xlsx with read-excel-file. Returns the raw grid; see
 * toSheet() in ./mapping for headers and row numbers. Also works in Node (tests).
 */
import Papa from "papaparse";

export class SpreadsheetError extends Error {}

/**
 * CSV text → rows of cells. Handles quotes, embedded commas/newlines, a UTF-8 BOM, and ; or tab
 * separators. Blank lines are kept (as [""]) so row numbers match what Excel shows; toSheet() drops them.
 */
export function parseCsvText(text: string): string[][] {
  const body = text.replace(/^\uFEFF/, "");
  // Guess the separator ignoring blank lines, then read every line with it.
  const guess = Papa.parse<string[]>(body.slice(0, 20_000), { skipEmptyLines: "greedy", delimitersToGuess: [",", "\t", ";", "|"], preview: 50 });
  const res = Papa.parse<string[]>(body, { skipEmptyLines: false, delimiter: guess.meta.delimiter || "," });
  if (!res.data.length || body.slice(0, 5000).includes("\u0000"))
    throw new SpreadsheetError("This file doesn't look like a spreadsheet. Save it as CSV or .xlsx and try again.");
  return res.data;
}

/** .xlsx bytes → rows of cells (the first sheet that has data). Dates come back as Date objects. */
export async function readXlsxBuffer(buf: ArrayBuffer): Promise<unknown[][]> {
  const { default: readXlsxFile } = await import("read-excel-file/universal");
  let sheets: { sheet: string; data: unknown[][] }[];
  try {
    sheets = (await readXlsxFile(buf)) as { sheet: string; data: unknown[][] }[];
  } catch {
    throw new SpreadsheetError("We couldn't open this Excel file. Try opening it in Excel and saving it again as .xlsx or CSV.");
  }
  const withData = sheets.find((s) => s.data.some((r) => r.some((c) => c != null && String(c).trim() !== "")));
  return withData?.data ?? [];
}

export async function readSpreadsheet(file: File): Promise<unknown[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) return readXlsxBuffer(await file.arrayBuffer());
  if (name.endsWith(".xls")) {
    throw new SpreadsheetError(
      "That's the old Excel format (.xls). Open it in Excel and use File → Save As → Excel Workbook (.xlsx) or CSV, then upload that.",
    );
  }
  if (/\.(csv|txt|tsv|tab)$/.test(name) || file.type.startsWith("text/") || file.type === "") return parseCsvText(await file.text());
  throw new SpreadsheetError("Please upload a CSV or Excel (.xlsx) file.");
}
