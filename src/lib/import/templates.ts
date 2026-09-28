/**
 * Downloadable CSV templates for Settings → Import: a header row the importer recognizes plus a
 * couple of example rows. Built in the browser, so they always match the fields in ./fields.
 */
import type { ImportKind } from "./fields";

export const TEMPLATES: Record<ImportKind, string[][]> = {
  customers: [
    [
      "Company Name",
      "First Name",
      "Last Name",
      "Phone",
      "Email",
      "Website",
      "Address",
      "Address 2",
      "City",
      "State",
      "Zip",
      "Billing Address",
      "Tax Exempt",
      "Tax Exempt ID",
      "Terms",
      "Customer Since",
      "Notes",
    ],
    [
      "Hometown Bakery",
      "Maria",
      "Lopez",
      "219-555-0123",
      "orders@hometownbakery.com",
      "hometownbakery.com",
      "412 Ridge Rd",
      "",
      "Munster",
      "IN",
      "46321",
      "",
      "No",
      "",
      "Net 30",
      "3/15/2012",
      "Likes proofs by email",
    ],
    [
      "",
      "Tom",
      "Becker",
      "219-555-0188",
      "tbecker@example.com",
      "",
      "88 Oak St",
      "Apt 2",
      "Highland",
      "IN",
      "46322",
      "",
      "",
      "",
      "Due on receipt",
      "",
      "Individual customer",
    ],
    [
      "St. Mary's Church",
      "Joan",
      "Kline",
      "219-555-0144",
      "office@stmarys.example.org",
      "",
      "100 Church Ln",
      "",
      "Hammond",
      "IN",
      "46320",
      "PO Box 12, Hammond, IN 46325",
      "Yes",
      "EX-4432",
      "Net 15",
      "2008-06-01",
      "",
    ],
  ],
  contacts: [
    ["Customer", "First Name", "Last Name", "Title", "Email", "Phone", "Cell", "Primary", "Notes"],
    ["Hometown Bakery", "Sam", "Lopez", "Owner", "sam@hometownbakery.com", "219-555-0124", "219-555-0199", "No", ""],
    ["St. Mary's Church", "Pat", "Green", "Events", "pat@stmarys.example.org", "219-555-0145", "", "No", "Handles festival signs"],
  ],
  jobs: [
    ["Job #", "Customer", "Date", "Title", "Description", "Qty", "Size", "Category", "Stock", "Total", "Tax", "Status", "PO #", "Notes"],
    [
      "24518",
      "Hometown Bakery",
      "4/2/2024",
      "Grand opening banner",
      "13oz vinyl banner, hemmed & grommeted",
      "1",
      "3x8",
      "Banners",
      "13oz Scrim Vinyl",
      "$145.00",
      "$0.00",
      "Invoiced",
      "",
      "",
    ],
    [
      "24519",
      "Hometown Bakery",
      "4/9/2024",
      "Business cards - Maria",
      "Full color both sides",
      "500",
      "3.5 x 2",
      "Business Cards",
      "14pt C2S Cover",
      "$62.50",
      "",
      "Closed",
      "",
      "",
    ],
    [
      "24544",
      "St. Mary's Church",
      "5/1/2024",
      "Festival flyers",
      "Full color, one side",
      "1,000",
      "8.5 x 11",
      "Flyers",
      "100# Gloss Text",
      "$189.00",
      "",
      "Closed",
      "PO-7781",
      "Tax exempt",
    ],
  ],
  materials: [
    ["Name", "Kind", "Unit", "Cost", "Cost per M", "Weight", "Sheet Size", "Vendor", "SKU"],
    ["100# Gloss Text 12x18", "Paper", "Sheet", "", "$85.00", "100# Text", "12 x 18", "Veritiv", "VT-100GT-1218"],
    ["14pt C2S Cover 13x19", "Paper", "Sheet", "", "$210.00", "14pt Cover", "13 x 19", "Midwest Paper Supply", ""],
    ["13oz Scrim Vinyl Banner", "Vinyl", "Sq Ft", "$0.38", "", "", "", "Grimco", "GR-13OZ-54"],
  ],
  vendors: [
    ["Vendor", "Contact", "Phone", "Email", "Website", "Account #", "Notes"],
    ["Veritiv", "Dana Price", "800-555-0100", "orders@veritiv.example.com", "veritivcorp.com", "4471-22", "Paper; next-day delivery"],
    ["Grimco", "", "800-555-0177", "", "grimco.com", "GR-88120", "Sign supplies"],
  ],
};

/** RFC 4180 CSV: quote cells with commas, quotes or line breaks. */
export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c ?? "");
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\r\n");
}
