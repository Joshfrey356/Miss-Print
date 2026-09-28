import { test } from "node:test";
import assert from "node:assert/strict";
import {
  combineName,
  excelSerialToYmd,
  nameKey,
  parseBool,
  parseCents,
  parseDate,
  parseEmail,
  parseInches,
  parsePhone,
  parseQuantity,
  parseSize,
  parseState,
  parseTerms,
  parseZip,
} from "../src/lib/import/parse";
import { autoMap, cellToString, findHeaderRow, normalizeHeader, pickFields, toSheet } from "../src/lib/import/mapping";
import { KINDS } from "../src/lib/import/fields";
import { matchCategory, normalizeContact, normalizeCustomer, normalizeJob, normalizeMaterial, normalizeVendor } from "../src/lib/import/records";
import { parseCsvText, readXlsxBuffer } from "../src/lib/import/read-file";
import { buildXlsx } from "./import-xlsx";

const headerOf = (kind: keyof typeof KINDS, headers: string[]) => {
  const m = autoMap(headers, kind);
  return Object.fromEntries(
    Object.entries(m)
      .filter(([, v]) => v != null)
      .map(([k, v]) => [k, headers[v!]]),
  );
};

test("money → cents", () => {
  assert.equal(parseCents("$1,234.50"), 123450);
  assert.equal(parseCents("1234.5"), 123450);
  assert.equal(parseCents(" $ 85 "), 8500);
  assert.equal(parseCents("(12.00)"), -1200);
  assert.equal(parseCents("12.00-"), -1200);
  assert.equal(parseCents("-$5"), -500);
  assert.equal(parseCents("USD 19.99"), 1999);
  assert.equal(parseCents(".5"), 50);
  assert.equal(parseCents(42.1), 4210);
  assert.equal(parseCents("0.125"), 13);
  assert.equal(parseCents(""), null);
  assert.equal(parseCents("n/a"), null);
  assert.equal(parseCents("twelve"), undefined);
  assert.equal(parseCents("12.3.4"), undefined);
});

test("dates: US formats, ISO, month names and Excel serials", () => {
  assert.equal(parseDate("3/7/2024"), "2024-03-07");
  assert.equal(parseDate("03/07/24"), "2024-03-07");
  assert.equal(parseDate("12/31/99"), "1999-12-31");
  assert.equal(parseDate("2024-03-07"), "2024-03-07");
  assert.equal(parseDate("2024/3/7"), "2024-03-07");
  assert.equal(parseDate("3-7-2024"), "2024-03-07");
  assert.equal(parseDate("3/7/2024 10:15 AM"), "2024-03-07");
  assert.equal(parseDate("2024-03-07T00:00:00Z"), "2024-03-07");
  assert.equal(parseDate("Mar 7, 2024"), "2024-03-07");
  assert.equal(parseDate("September 30 2023"), "2023-09-30");
  assert.equal(parseDate("7-Mar-24"), "2024-03-07");
  assert.equal(parseDate("45358"), "2024-03-07");
  assert.equal(parseDate(45358), "2024-03-07");
  assert.equal(excelSerialToYmd(1), "1899-12-31");
  assert.equal(parseDate("20240307"), "2024-03-07");
  assert.equal(parseDate(""), null);
  assert.equal(parseDate("2/30/2024"), undefined);
  assert.equal(parseDate("13/1/2024"), undefined);
  assert.equal(parseDate("next Tuesday"), undefined);
});

test("sizes → inches", () => {
  assert.deepEqual(parseSize("4x8"), { widthIn: 4, heightIn: 8 });
  assert.deepEqual(parseSize("4x8", { feetWhenSmall: true }), { widthIn: 48, heightIn: 96, assumedFeet: true });
  assert.deepEqual(parseSize("18x24", { feetWhenSmall: true }), { widthIn: 18, heightIn: 24 });
  assert.deepEqual(parseSize("8.5 x 11"), { widthIn: 8.5, heightIn: 11 });
  assert.deepEqual(parseSize('24"x36"'), { widthIn: 24, heightIn: 36 });
  assert.deepEqual(parseSize("2'x4'"), { widthIn: 24, heightIn: 48 });
  assert.deepEqual(parseSize("3 ft x 6 ft"), { widthIn: 36, heightIn: 72 });
  assert.deepEqual(parseSize("3 x 6 ft"), { widthIn: 36, heightIn: 72 });
  assert.deepEqual(parseSize("8 1/2 x 11"), { widthIn: 8.5, heightIn: 11 });
  assert.deepEqual(parseSize("8-1/2 X 11"), { widthIn: 8.5, heightIn: 11 });
  assert.deepEqual(parseSize(`2'6" x 4'`), { widthIn: 30, heightIn: 48 });
  assert.deepEqual(parseSize("3.5 × 2"), { widthIn: 3.5, heightIn: 2 });
  assert.deepEqual(parseSize("12x18 (full bleed)"), { widthIn: 12, heightIn: 18 });
  assert.deepEqual(parseSize("24in x 36in"), { widthIn: 24, heightIn: 36 });
  assert.deepEqual(parseSize("2 by 3 feet"), { widthIn: 24, heightIn: 36 });
  assert.equal(parseSize(""), null);
  assert.equal(parseSize("large"), undefined);
  assert.equal(parseInches('24"'), 24);
  assert.equal(parseInches("2 ft"), 24);
  assert.equal(parseInches("11"), 11);
});

test("quantities, yes/no, terms, contact details", () => {
  assert.equal(parseQuantity("1,000"), 1000);
  assert.equal(parseQuantity("500 pcs"), 500);
  assert.equal(parseQuantity("2.5M"), 2500);
  assert.equal(parseQuantity("5k"), 5000);
  assert.equal(parseQuantity("250.00"), 250);
  assert.equal(parseQuantity("lots"), undefined);
  assert.equal(parseBool("Yes"), true);
  assert.equal(parseBool("X"), true);
  assert.equal(parseBool("Exempt"), true);
  assert.equal(parseBool("N"), false);
  assert.equal(parseBool("Taxable"), false);
  assert.equal(parseBool(""), null);
  assert.equal(parseBool("maybe"), undefined);
  assert.deepEqual(parseTerms("Net 30"), { terms: "net_30", exact: true });
  assert.deepEqual(parseTerms("N30"), { terms: "net_30", exact: true });
  assert.deepEqual(parseTerms("30 Days"), { terms: "net_30", exact: true });
  assert.deepEqual(parseTerms("COD"), { terms: "due_on_receipt", exact: true });
  assert.deepEqual(parseTerms("Due upon receipt"), { terms: "due_on_receipt", exact: true });
  assert.deepEqual(parseTerms("Net 10"), { terms: "net_15", exact: false });
  assert.equal(parseTerms("whenever"), undefined);
  assert.deepEqual(parseEmail("Bob@Example.COM"), { email: "bob@example.com", more: false });
  assert.deepEqual(parseEmail("Bob <bob@x.com>; amy@x.com"), { email: "bob@x.com", more: true });
  assert.equal(parseEmail("bob@"), undefined);
  assert.equal(parsePhone("2195550142"), "219-555-0142");
  assert.equal(parsePhone(12195550142), "219-555-0142");
  assert.equal(parsePhone("(219) 555-0142 x12"), "(219) 555-0142 x12");
  assert.equal(parsePhone("555"), undefined);
  assert.equal(parseState("Indiana"), "IN");
  assert.equal(parseState("il"), "IL");
  assert.equal(parseZip("6511"), "06511");
  assert.equal(parseZip(463211234), "46321-1234");
  assert.equal(parseZip("46321"), "46321");
});

test("names: combining first + last, and matching keys", () => {
  assert.equal(combineName(" Mary ", "Jones"), "Mary Jones");
  assert.equal(combineName("", "Jones"), "Jones");
  assert.equal(combineName(undefined, null), "");
  assert.equal(nameKey("ABC Plumbing, Inc."), nameKey("abc plumbing inc"));
  assert.equal(nameKey("  Region Roofing & Siding "), "region roofing and siding");
  assert.equal(nameKey("Region Roofing and Siding"), nameKey("Region Roofing & Siding"));
  assert.equal(nameKey("Hoosier Landscape Co."), "hoosier landscape");
  assert.equal(nameKey("Smith Manufacturing, LLC"), nameKey("smith manufacturing"));
  assert.equal(nameKey("Co"), "co");
});

test("headers: normalizing and auto-matching Printer's Plan style columns", () => {
  assert.equal(normalizeHeader("E-mail Address"), "email address");
  assert.equal(normalizeHeader("Job #"), "job no");
  assert.equal(normalizeHeader("Job No."), "job no");
  assert.equal(normalizeHeader("Job Number"), "job no");
  assert.equal(normalizeHeader("Address1"), "address 1");
  assert.equal(normalizeHeader("Zip/Postal Code"), "zip postal code");

  assert.deepEqual(
    headerOf("customers", [
      "Customer #",
      "Company Name",
      "First Name",
      "Last Name",
      "Address 1",
      "Address 2",
      "City",
      "State",
      "Zip Code",
      "Phone 1",
      "Fax",
      "E-mail",
      "Tax Exempt",
      "Tax ID",
      "Terms",
      "Notes",
    ]),
    {
      oldNumber: "Customer #",
      name: "Company Name",
      contactFirstName: "First Name",
      contactLastName: "Last Name",
      address: "Address 1",
      address2: "Address 2",
      city: "City",
      state: "State",
      zip: "Zip Code",
      phone: "Phone 1",
      fax: "Fax",
      email: "E-mail",
      taxExempt: "Tax Exempt",
      taxExemptId: "Tax ID",
      paymentTerms: "Terms",
      notes: "Notes",
    },
  );
  // "Name" + "Contact": the name is the customer, the contact is the person.
  assert.deepEqual(headerOf("customers", ["Name", "Contact", "Work Phone", "Email Address", "Street", "Postal Code"]), {
    name: "Name",
    contactName: "Contact",
    phone: "Work Phone",
    email: "Email Address",
    address: "Street",
    zip: "Postal Code",
  });
  // Billing columns don't steal the main address, and vice versa.
  const billing = headerOf("customers", ["Customer", "Billing Address", "Billing City", "Address", "City"]);
  assert.equal(billing.address, "Address");
  assert.equal(billing.city, "City");
  assert.equal(billing.billingAddress, "Billing Address");
  assert.equal(billing.billingCity, "Billing City");

  const jobs = headerOf("jobs", ["Job #", "Customer", "Order Date", "Job Description", "Qty", "Size", "Category", "Unit Price", "Total", "Status"]);
  assert.deepEqual(jobs, {
    legacyNumber: "Job #",
    customerName: "Customer",
    date: "Order Date",
    title: "Job Description",
    quantity: "Qty",
    size: "Size",
    category: "Category",
    amount: "Total",
    status: "Status",
  });
  // "Price" is used when there's no total; "Invoice #" works as the old number.
  const jobs2 = headerOf("jobs", ["Invoice #", "Customer Name", "Date", "Description", "Quantity", "Price", "Customer PO"]);
  assert.equal(jobs2.legacyNumber, "Invoice #");
  assert.equal(jobs2.customerName, "Customer Name");
  assert.equal(jobs2.description, "Description");
  assert.equal(jobs2.amount, "Price");
  assert.equal(jobs2.poNumber, "Customer PO");

  const mats = headerOf("materials", ["Stock", "Weight", "Sheet Size", "Cost/M", "Vendor", "Item #"]);
  assert.deepEqual(mats, { name: "Stock", weight: "Weight", size: "Sheet Size", costPerM: "Cost/M", vendor: "Vendor", sku: "Item #" });

  const contacts = headerOf("contacts", ["Company", "First Name", "Last Name", "Title", "E-mail", "Phone", "Cell"]);
  assert.deepEqual(contacts, {
    customerName: "Company",
    firstName: "First Name",
    lastName: "Last Name",
    title: "Title",
    email: "E-mail",
    phone: "Phone",
    mobile: "Cell",
  });

  const vendors = headerOf("vendors", ["Vendor", "Contact", "Phone", "Fax", "Account #"]);
  assert.deepEqual(vendors, { name: "Vendor", contactName: "Contact", phone: "Phone", accountNumber: "Account #" });
});

test("sheet reading: title rows skipped, blank rows dropped, row numbers kept", () => {
  const grid = [["Customer List — printed 9/28/2026"], [], ["Name", "Phone"], ["ABC", "219"], ["", ""], ["XYZ", ""]];
  assert.equal(findHeaderRow(grid), 2);
  const s = toSheet(grid);
  assert.deepEqual(s.headers, ["Name", "Phone"]);
  assert.deepEqual(s.rows, [
    ["ABC", "219"],
    ["XYZ", ""],
  ]);
  assert.deepEqual(s.rowNumbers, [4, 6]);
  assert.deepEqual(pickFields(["ABC", " "], { name: 0, phone: 1, email: null }), { name: "ABC" });
  assert.equal(cellToString(new Date(Date.UTC(2024, 2, 7))), "2024-03-07");
  assert.equal(cellToString(2195550142), "2195550142");
  assert.equal(cellToString(0.1 + 0.2), "0.3");
  assert.equal(cellToString(true), "Yes");
});

test("CSV parsing handles quotes, commas, BOM and semicolons", () => {
  const sheet = toSheet(parseCsvText('\uFEFFCustomer list\n\nName,Notes\n"Smith, Jones & Co","says ""hi""\nline 2"\n\nB,x\n'));
  assert.deepEqual(sheet.headers, ["Name", "Notes"]);
  assert.deepEqual(sheet.rows, [
    ["Smith, Jones & Co", 'says "hi"\nline 2'],
    ["B", "x"],
  ]);
  // Row numbers as Excel shows them: the blank line (row 5) still counts; a quoted line break doesn't.
  assert.deepEqual(sheet.rowNumbers, [4, 6]);
  assert.deepEqual(toSheet(parseCsvText("a;b\n1;2\n")).rows, [["1", "2"]]);
});

test("xlsx parsing: strings, numbers and dates from a real workbook", async () => {
  const buf = buildXlsx([
    ["Customer", "Phone", "Since", "Total"],
    ["ABC Plumbing", 2195550142, new Date(Date.UTC(2021, 4, 3)), 1234.5],
    ["Smith & Sons", "219-555-0101", null, 99],
  ]);
  const grid = await readXlsxBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const sheet = toSheet(grid);
  assert.deepEqual(sheet.headers, ["Customer", "Phone", "Since", "Total"]);
  assert.deepEqual(sheet.rows[0], ["ABC Plumbing", "2195550142", "2021-05-03", "1234.5"]);
  assert.deepEqual(sheet.rows[1], ["Smith & Sons", "219-555-0101", "", "99"]);
  const n = normalizeCustomer(pickFields(sheet.rows[0]!, { name: 0, phone: 1, customerSince: 2 }));
  assert.equal(n.values?.phone, "219-555-0142");
  assert.equal(n.values?.customerSince, "2021-05-03");
});

test("customer rows: validation, person names, notes and tax", () => {
  assert.deepEqual(normalizeCustomer({ phone: "219" }).errors, ["Missing customer name"]);
  const person = normalizeCustomer({ contactFirstName: "Mary", contactLastName: "Jones", email: "mary@x.com" });
  assert.equal(person.values?.name, "Mary Jones");
  assert.equal(person.values?.isCompany, false);
  assert.equal(person.values?.contact, null); // no separate contact for a person with nothing more to say

  const c = normalizeCustomer({
    name: "  ABC   Plumbing ",
    contactFirstName: "Bob",
    contactLastName: "Smith",
    email: "bad@",
    phone: "2195550142",
    fax: "219-555-0143",
    oldNumber: "C1042",
    address: "123 Main St",
    address2: "Suite 4",
    state: "Indiana",
    zip: "6511",
    taxExempt: "Y",
    taxExemptId: "EX-99",
    paymentTerms: "Net 10",
    customerSince: "13/13/2020",
  });
  assert.deepEqual(c.errors, []);
  assert.equal(c.values?.name, "ABC Plumbing");
  assert.equal(c.values?.isCompany, true);
  assert.equal(c.values?.email, null);
  assert.equal(c.values?.phone, "219-555-0142");
  assert.equal(c.values?.address, "123 Main St, Suite 4");
  assert.equal(c.values?.state, "IN");
  assert.equal(c.values?.zip, "06511");
  assert.equal(c.values?.taxExempt, true);
  assert.equal(c.values?.taxExemptId, "EX-99");
  assert.equal(c.values?.paymentTerms, "net_15");
  assert.equal(c.values?.customerSince, null);
  assert.equal(c.values?.notes, "Fax: 219-555-0143\nOld customer #: C1042");
  assert.deepEqual(c.values?.contact, { name: "Bob Smith", title: null, email: null, phone: null });
  assert.equal(c.warnings.length, 3); // bad email, inexact terms, bad date

  // "Taxable: No" means exempt; a tax ID without exemption is kept in the notes.
  assert.equal(normalizeCustomer({ name: "A", taxable: "No" }).values?.taxExempt, true);
  const notExempt = normalizeCustomer({ name: "A", taxExemptId: "12-345" }).values;
  assert.equal(notExempt?.taxExempt, null);
  assert.equal(notExempt?.taxExemptId, null);
  assert.equal(notExempt?.notes, "Tax ID: 12-345");
});

test("contact, vendor and material rows", () => {
  assert.deepEqual(normalizeContact({ name: "Bob" }).errors, ["Missing customer name"]);
  const ct = normalizeContact({ customerName: "ABC", firstName: "Bob", lastName: "Smith", phone: "219-555-0100", mobile: "219-555-0199", isPrimary: "yes" });
  assert.equal(ct.values?.name, "Bob Smith");
  assert.equal(ct.values?.notes, "Cell: 219-555-0199");
  assert.equal(ct.values?.isPrimary, true);

  const v = normalizeVendor({ name: "Veritiv", contactFirstName: "Al", contactLastName: "Po", city: "Chicago", state: "Illinois" });
  assert.equal(v.values?.contactName, "Al Po");
  assert.equal(v.values?.notes, "Address: Chicago, IL");

  const paper = normalizeMaterial({ name: "100# Gloss Text", size: "12x18", costPerM: "$85.00", vendor: "Veritiv" });
  assert.deepEqual(paper.values, {
    name: "100# Gloss Text",
    kind: "paper",
    unit: "sheet",
    costCents: 9,
    costPerMCents: 8500,
    weight: null,
    sheetWidthIn: 12,
    sheetHeightIn: 18,
    vendorName: "Veritiv",
    sku: null,
  });
  const perSheet = normalizeMaterial({ name: "14pt C2S Cover 19x13", kind: "Paper", cost: "0.22", sheetWidth: "19", sheetHeight: "13" });
  assert.equal(perSheet.values?.costPerMCents, 22000);
  assert.equal(perSheet.values?.costCents, 22);
  const vinyl = normalizeMaterial({ name: "13oz Scrim Vinyl Banner", cost: "$0.45", unit: "sq ft" });
  assert.equal(vinyl.values?.kind, "vinyl");
  assert.equal(vinyl.values?.unit, "sqft");
  assert.equal(vinyl.values?.costCents, 45);
  assert.equal(vinyl.values?.costPerMCents, null);
  assert.deepEqual(normalizeMaterial({ name: "X", cost: "cheap" }).errors, ["Couldn't read the cost “cheap”"]);
});

const CATS = [
  { id: 1, name: "Business Cards", slug: "business-cards", group: "print" },
  { id: 3, name: "Flyers", slug: "flyers", group: "print" },
  { id: 4, name: "Postcards & Mailers", slug: "postcards-mailers", group: "print" },
  { id: 11, name: "Banners", slug: "banners", group: "sign" },
  { id: 15, name: "Retractable Banner Stands", slug: "banner-stands", group: "sign" },
  { id: 12, name: "Yard Signs", slug: "yard-signs", group: "sign" },
];

test("categories are matched by name, loosely", () => {
  assert.equal(matchCategory(CATS, "Banner")?.id, 11);
  assert.equal(matchCategory(CATS, "business cards")?.id, 1);
  assert.equal(matchCategory(CATS, "Business Card")?.id, 1);
  assert.equal(matchCategory(CATS, "postcards-mailers")?.id, 4);
  assert.equal(matchCategory(CATS, "Postcards")?.id, 4);
  assert.equal(matchCategory(CATS, "Vinyl Banner 13oz")?.id, 11);
  assert.equal(matchCategory(CATS, "Door Hangers"), null);
  assert.equal(matchCategory(CATS, ""), null);
});

test("past-job rows: price, date, size in feet for signs, status", () => {
  const j = normalizeJob(
    {
      legacyNumber: "24-1107",
      customerName: "ABC Plumbing",
      date: "3/7/2024",
      description: "Vinyl banner w/ grommets",
      quantity: "2",
      size: "4x8",
      category: "Banner",
      amount: "$1,234.50",
      status: "Invoiced",
    },
    { categories: CATS },
  );
  assert.deepEqual(j.errors, []);
  assert.equal(j.values?.priceCents, 123450);
  assert.equal(j.values?.date, "2024-03-07");
  assert.equal(j.values?.widthIn, 48);
  assert.equal(j.values?.heightIn, 96);
  assert.equal(j.values?.categoryId, 11);
  assert.equal(j.values?.status, "completed");
  assert.equal(j.values?.originalStatus, null);
  assert.equal(j.values?.title, "Vinyl banner w/ grommets");
  assert.ok(j.warnings.some((w) => w.includes("read as feet")));

  const cards = normalizeJob(
    { customerName: "A", date: "2024-01-02", title: "Business cards", quantity: "1,000", size: "3.5x2", category: "Business Cards", amount: "85" },
    { categories: CATS },
  );
  assert.equal(cards.values?.widthIn, 3.5);
  assert.equal(cards.values?.quantity, 1000);

  const bad = normalizeJob({ customerName: "", date: "someday", amount: "abc" });
  assert.deepEqual(bad.errors, ["Missing customer name", "Couldn't read the date “someday”", "Couldn't read the price “abc”"]);
  assert.equal(bad.values, null);

  assert.equal(normalizeJob({ customerName: "A", amount: "1", status: "Cancelled" }).values?.status, "cancelled");
  assert.equal(normalizeJob({ customerName: "A", amount: "1", status: "On Hold" }).values?.originalStatus, "On Hold");
  const noDate = normalizeJob({ customerName: "A", amount: "5" });
  assert.equal(noDate.values?.date, null);
  assert.ok(noDate.warnings.some((w) => w.includes("No date")));
});

test("every CSV template is recognized column-for-column and its rows import cleanly", async () => {
  const { TEMPLATES, toCsv } = await import("../src/lib/import/templates");
  const { normalizeRow } = await import("../src/lib/import/records");
  for (const [kind, rows] of Object.entries(TEMPLATES) as [keyof typeof KINDS, string[][]][]) {
    const [headers, ...data] = rows;
    const m = autoMap(headers!, kind);
    const mapped = new Set(Object.values(m).filter((v) => v != null));
    assert.equal(mapped.size, headers!.length, `${kind}: every template column should map (${headers!.filter((_, i) => !mapped.has(i)).join(", ")})`);
    for (const r of data) assert.deepEqual(normalizeRow(kind, pickFields(r, m), { categories: CATS }).errors, [], `${kind}: ${r.join(",")}`);
    // Round-trips through CSV.
    assert.deepEqual(parseCsvText(toCsv(rows)), rows);
  }
});
