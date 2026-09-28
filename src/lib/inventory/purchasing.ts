import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { jobs, locations, materials, purchaseOrderItems, purchaseOrders, users, vendors } from "@/lib/db/schema";
import { UserError } from "@/lib/actions";
import { logActivity } from "@/lib/activity";
import { emailProvider } from "@/lib/email";
import { getSettings } from "@/lib/settings";
import { money, poNo, today } from "@/lib/format";
import { nextNumber } from "@/lib/tenant";
import { lineAmount, poTotals, roundQty, suggestedOrderQty, unitCostOf, type PoStatus } from "./math";
import { poEmail } from "./po-text";
import { listStock } from "./queries";
import { logInventory, type StockActor } from "./service";

// ---------------------------------------------------------------------------
// Lists & detail
// ---------------------------------------------------------------------------

export const PO_FILTERS = ["open", "draft", "ordered", "late", "received", "cancelled", "all"] as const;
export type PoFilter = (typeof PO_FILTERS)[number];

function filterWhere(f: PoFilter): SQL | undefined {
  switch (f) {
    case "open":
      return inArray(purchaseOrders.status, ["draft", "ordered", "partial"]);
    case "draft":
      return eq(purchaseOrders.status, "draft");
    case "ordered":
      return inArray(purchaseOrders.status, ["ordered", "partial"]);
    case "late":
      return and(inArray(purchaseOrders.status, ["ordered", "partial"]), sql`${purchaseOrders.expectedOn} < ${today()}`);
    case "received":
      return eq(purchaseOrders.status, "received");
    case "cancelled":
      return eq(purchaseOrders.status, "cancelled");
    default:
      return undefined;
  }
}

export async function listPurchaseOrders(tenantId: number, opts: { filter: PoFilter; q?: string }) {
  const q = opts.q?.trim();
  const num = q ? Number(q.replace(/^po-?/i, "")) : NaN;
  const search = q
    ? or(ilike(vendors.name, `%${q}%`), Number.isInteger(num) && num > 0 ? eq(purchaseOrders.number, num) : undefined, sql`exists (select 1 from ${purchaseOrderItems} where ${purchaseOrderItems.tenantId} = ${tenantId} and ${purchaseOrderItems.purchaseOrderId} = ${purchaseOrders.id} and ${purchaseOrderItems.description} ilike ${`%${q}%`})`)
    : undefined;
  const rows = await db
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      status: purchaseOrders.status,
      vendorName: vendors.name,
      orderedOn: purchaseOrders.orderedOn,
      expectedOn: purchaseOrders.expectedOn,
      receivedOn: purchaseOrders.receivedOn,
      totalCents: purchaseOrders.totalCents,
      createdAt: purchaseOrders.createdAt,
      jobNumber: jobs.number,
      lines: sql<number>`(select count(*) from ${purchaseOrderItems} where ${purchaseOrderItems.tenantId} = ${tenantId} and ${purchaseOrderItems.purchaseOrderId} = ${purchaseOrders.id})::int`,
      summary: sql<string | null>`(select string_agg(${purchaseOrderItems.description}, ', ' order by ${purchaseOrderItems.sortOrder}) from ${purchaseOrderItems} where ${purchaseOrderItems.tenantId} = ${tenantId} and ${purchaseOrderItems.purchaseOrderId} = ${purchaseOrders.id})`,
    })
    .from(purchaseOrders)
    .innerJoin(vendors, and(eq(vendors.tenantId, purchaseOrders.tenantId), eq(vendors.id, purchaseOrders.vendorId)))
    .leftJoin(jobs, and(eq(jobs.tenantId, purchaseOrders.tenantId), eq(jobs.id, purchaseOrders.jobId)))
    .where(and(eq(purchaseOrders.tenantId, tenantId), filterWhere(opts.filter), search))
    .orderBy(desc(purchaseOrders.number))
    .limit(300);
  return rows;
}

export async function poCounts(tenantId: number) {
  const t = today();
  const rows = await db
    .select({ status: purchaseOrders.status, n: sql<number>`count(*)::int`, late: sql<number>`(count(*) filter (where ${purchaseOrders.expectedOn} < ${t}))::int` })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.tenantId, tenantId))
    .groupBy(purchaseOrders.status);
  const c = (s: PoStatus[]) => rows.filter((r) => s.includes(r.status)).reduce((a, r) => a + r.n, 0);
  return {
    open: c(["draft", "ordered", "partial"]),
    draft: c(["draft"]),
    ordered: c(["ordered", "partial"]),
    late: rows.filter((r) => r.status === "ordered" || r.status === "partial").reduce((a, r) => a + r.late, 0),
  };
}

export async function getPurchaseOrder(tenantId: number, id: number) {
  const [row] = await db
    .select({ po: purchaseOrders, vendor: vendors, location: locations, jobNumber: jobs.number, jobTitle: jobs.title, createdByName: users.name })
    .from(purchaseOrders)
    .innerJoin(vendors, and(eq(vendors.tenantId, purchaseOrders.tenantId), eq(vendors.id, purchaseOrders.vendorId)))
    .leftJoin(locations, and(eq(locations.tenantId, purchaseOrders.tenantId), eq(locations.id, purchaseOrders.locationId)))
    .leftJoin(jobs, and(eq(jobs.tenantId, purchaseOrders.tenantId), eq(jobs.id, purchaseOrders.jobId)))
    .leftJoin(users, and(eq(users.tenantId, purchaseOrders.tenantId), eq(users.id, purchaseOrders.createdBy)))
    .where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id)));
  if (!row) return null;
  const lines = await db
    .select({ line: purchaseOrderItems, materialName: materials.name, sku: materials.sku, tracked: materials.trackInventory, jobNumber: jobs.number })
    .from(purchaseOrderItems)
    .leftJoin(materials, and(eq(materials.tenantId, purchaseOrderItems.tenantId), eq(materials.id, purchaseOrderItems.materialId)))
    .leftJoin(jobs, and(eq(jobs.tenantId, purchaseOrderItems.tenantId), eq(jobs.id, purchaseOrderItems.jobId)))
    .where(and(eq(purchaseOrderItems.tenantId, tenantId), eq(purchaseOrderItems.purchaseOrderId, id)))
    .orderBy(asc(purchaseOrderItems.sortOrder), asc(purchaseOrderItems.id));
  return { ...row, lines };
}

/** What the PO form needs: vendors, locations, materials (with unit & cost) and open jobs. */
export async function poFormOptions(tenantId: number) {
  const [vs, locs, mats] = await Promise.all([
    db.select({ id: vendors.id, name: vendors.name, email: vendors.email }).from(vendors).where(and(eq(vendors.tenantId, tenantId), sql`${vendors.archivedAt} is null`)).orderBy(asc(vendors.name)),
    db.select({ id: locations.id, name: locations.name }).from(locations).where(eq(locations.tenantId, tenantId)).orderBy(asc(locations.sortOrder), asc(locations.id)),
    db
      .select({ id: materials.id, name: materials.name, unit: materials.unit, sku: materials.sku, costCents: materials.costCents, costPerMCents: materials.costPerMCents, vendorId: materials.vendorId, tracked: materials.trackInventory })
      .from(materials)
      .where(and(eq(materials.tenantId, tenantId), eq(materials.active, true)))
      .orderBy(asc(materials.name)),
  ]);
  return {
    vendors: vs,
    locations: locs,
    materials: mats.map((m) => ({ id: m.id, name: m.name, unit: m.unit, sku: m.sku, vendorId: m.vendorId, tracked: m.tracked, unitCostCents: unitCostOf(m) })),
  };
}

// ---------------------------------------------------------------------------
// Create / edit (drafts)
// ---------------------------------------------------------------------------

export type PoLineInput = { materialId: number | null; description: string; quantity: number; unit: string | null; unitCostCents: number; jobId: number | null };
export type PoInput = {
  vendorId: number;
  locationId: number | null;
  expectedOn: string | null;
  jobId: number | null;
  notes: string | null;
  shippingCents: number;
  taxCents: number;
  lines: PoLineInput[];
};

async function checkRefs(tx: Tx, tenantId: number, input: PoInput) {
  const [v] = await tx.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.tenantId, tenantId), eq(vendors.id, input.vendorId)));
  if (!v) throw new UserError("Choose a vendor.");
  if (input.locationId) {
    const [l] = await tx.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, input.locationId)));
    if (!l) throw new UserError("Choose where it should be delivered.");
  }
  const jobIds = [...new Set([input.jobId, ...input.lines.map((l) => l.jobId)].filter((x): x is number => !!x))];
  if (jobIds.length) {
    const found = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.tenantId, tenantId), inArray(jobs.id, jobIds)));
    if (found.length !== jobIds.length) throw new UserError("A job on this order wasn't found.");
  }
  const matIds = [...new Set(input.lines.map((l) => l.materialId).filter((x): x is number => !!x))];
  if (matIds.length) {
    const found = await tx.select({ id: materials.id }).from(materials).where(and(eq(materials.tenantId, tenantId), inArray(materials.id, matIds)));
    if (found.length !== matIds.length) throw new UserError("An item on this order wasn't found.");
  }
}

function cleanInput(input: PoInput): PoInput {
  const lines = input.lines
    .map((l) => ({ ...l, description: l.description.trim().slice(0, 300), quantity: roundQty(l.quantity), unitCostCents: Math.round(l.unitCostCents * 10000) / 10000, unit: l.unit?.trim() || null }))
    .filter((l) => l.description || l.materialId);
  if (!lines.length) throw new UserError("Add at least one line to the order.");
  for (const l of lines) {
    if (!l.description) throw new UserError("Every line needs a description.");
    if (!(l.quantity > 0) || l.quantity > 100_000_000) throw new UserError(`Check the quantity for “${l.description}”.`);
    if (!(l.unitCostCents >= 0) || l.unitCostCents > 100_000_000) throw new UserError(`Check the cost for “${l.description}”.`);
  }
  for (const c of [input.shippingCents, input.taxCents]) if (!Number.isInteger(c) || c < 0 || c > 100_000_000) throw new UserError("Check the shipping and tax amounts.");
  return { ...input, lines, notes: input.notes?.trim() || null };
}

/** Create a draft PO, or replace a draft's details and lines. Returns its id. */
export async function savePurchaseOrder(tx: Tx, tenantId: number, id: number | null, raw: PoInput, actor: StockActor): Promise<{ id: number; number: number }> {
  const input = cleanInput(raw);
  await checkRefs(tx, tenantId, input);
  const totals = poTotals(input.lines, input.shippingCents, input.taxCents);
  const header = { vendorId: input.vendorId, locationId: input.locationId, expectedOn: input.expectedOn, jobId: input.jobId, notes: input.notes, ...totals, updatedAt: new Date() };
  let po: { id: number; number: number };
  if (id) {
    const [before] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id))).for("update");
    if (!before) throw new UserError("Purchase order not found.");
    if (before.status !== "draft") throw new UserError("Only draft purchase orders can be changed.");
    await tx.update(purchaseOrders).set(header).where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id)));
    // Draft lines have nothing received yet: replace them.
    await tx.delete(purchaseOrderItems).where(and(eq(purchaseOrderItems.tenantId, tenantId), eq(purchaseOrderItems.purchaseOrderId, id)));
    po = { id, number: before.number };
    await logInventory(tx, { tenantId, action: "po.updated", entityType: "purchase_order", entityId: id, jobId: input.jobId, actorId: actor.id, summary: `Updated ${poNo(before.number)} (${money(totals.totalCents)})`, data: { before: { totalCents: before.totalCents }, after: { totalCents: totals.totalCents } } });
  } else {
    const [row] = await tx
      .insert(purchaseOrders)
      .values({ tenantId, number: await nextNumber(tx, tenantId, "po"), status: "draft", createdBy: actor.id, ...header })
      .returning({ id: purchaseOrders.id, number: purchaseOrders.number });
    po = row!;
    await logInventory(tx, { tenantId, action: "po.created", entityType: "purchase_order", entityId: po.id, jobId: input.jobId, actorId: actor.id, summary: `Created ${poNo(po.number)} (${money(totals.totalCents)})` });
  }
  await tx.insert(purchaseOrderItems).values(
    input.lines.map((l, i) => ({
      tenantId,
      purchaseOrderId: po.id,
      materialId: l.materialId,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitCostCents: l.unitCostCents,
      amountCents: lineAmount(l.quantity, l.unitCostCents),
      jobId: l.jobId,
      sortOrder: i,
    })),
  );
  return po;
}

/** Draft → ordered, optionally emailing the vendor (plain-text PO, from the shop's name, replies to the shop). */
export async function placeOrder(tx: Tx, tenantId: number, id: number, opts: { email: string | null; message: string | null; saveEmail: boolean }, actor: StockActor) {
  const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id))).for("update");
  if (!po) throw new UserError("Purchase order not found.");
  if (po.status === "cancelled" || po.status === "received") throw new UserError(`This purchase order is ${po.status}.`);
  const first = po.status === "draft";
  const orderedOn = po.orderedOn ?? today();
  let emailed: string | null = null;
  if (opts.email) {
    const to = opts.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new UserError("Enter a valid email address for the vendor.");
    const msg = await buildPoEmail(tx, tenantId, { ...po, orderedOn }, opts.message);
    const { company } = await getSettings(tenantId);
    const r = await emailProvider().send({ to, subject: msg.subject, text: msg.text, fromName: company.name || undefined, replyTo: company.email || undefined });
    if (!r.ok) throw new UserError(`The email didn't send${r.error ? `: ${r.error}` : ""}. Nothing was changed.`);
    emailed = to;
    if (opts.saveEmail) await tx.update(vendors).set({ email: to }).where(and(eq(vendors.tenantId, tenantId), eq(vendors.id, po.vendorId)));
  }
  await tx
    .update(purchaseOrders)
    .set({ status: first ? "ordered" : po.status, orderedOn, sentAt: emailed ? new Date() : po.sentAt, updatedAt: new Date() })
    .where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, po.id)));
  await logInventory(tx, {
    tenantId,
    action: first ? "po.ordered" : "po.emailed",
    entityType: "purchase_order",
    entityId: po.id,
    jobId: po.jobId,
    actorId: actor.id,
    summary: first ? `Ordered ${poNo(po.number)}${emailed ? ` — emailed to ${emailed}` : ""}` : `Emailed ${poNo(po.number)} to ${emailed}`,
    data: first ? { before: { status: po.status }, after: { status: "ordered" } } : null,
  });
  return { emailed };
}

async function buildPoEmail(tx: Tx, tenantId: number, po: typeof purchaseOrders.$inferSelect, message: string | null) {
  const [{ company }, [vendor], lines, [loc]] = await Promise.all([
    getSettings(tenantId),
    tx.select().from(vendors).where(and(eq(vendors.tenantId, tenantId), eq(vendors.id, po.vendorId))),
    tx
      .select({ line: purchaseOrderItems, sku: materials.sku })
      .from(purchaseOrderItems)
      .leftJoin(materials, and(eq(materials.tenantId, purchaseOrderItems.tenantId), eq(materials.id, purchaseOrderItems.materialId)))
      .where(and(eq(purchaseOrderItems.tenantId, tenantId), eq(purchaseOrderItems.purchaseOrderId, po.id)))
      .orderBy(asc(purchaseOrderItems.sortOrder)),
    po.locationId ? tx.select({ name: locations.name, address: locations.address }).from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, po.locationId))) : Promise.resolve([]),
  ]);
  return poEmail({
    company,
    vendor: { name: vendor?.name ?? "", contactName: vendor?.contactName, accountNumber: vendor?.accountNumber },
    po,
    deliverTo: loc ? { name: loc.name, address: loc.address } : null,
    lines: lines.map(({ line, sku }) => ({ ...line, sku })),
    message,
  });
}

/** Preview of the email (for the "Place order" dialog). */
export async function previewPoEmail(tenantId: number, id: number) {
  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id)));
    if (!po) return null;
    return buildPoEmail(tx, tenantId, { ...po, orderedOn: po.orderedOn ?? today() }, null);
  });
}

/** Cancel a PO that has nothing received. */
export async function cancelPurchaseOrder(tx: Tx, tenantId: number, id: number, reason: string | null, actor: StockActor) {
  const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id))).for("update");
  if (!po) throw new UserError("Purchase order not found.");
  if (po.status === "cancelled") return;
  const [got] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(purchaseOrderItems)
    .where(and(eq(purchaseOrderItems.tenantId, tenantId), eq(purchaseOrderItems.purchaseOrderId, id), sql`${purchaseOrderItems.receivedQuantity} > 0`));
  if (po.status === "received" || (got?.n ?? 0) > 0) throw new UserError("Something on this order was already received, so it can't be cancelled.");
  await tx.update(purchaseOrders).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id)));
  await logInventory(tx, {
    tenantId,
    action: "po.cancelled",
    entityType: "purchase_order",
    entityId: id,
    jobId: po.jobId,
    actorId: actor.id,
    summary: `Cancelled ${poNo(po.number)}${reason ? `: ${reason}` : ""}`,
    data: { before: { status: po.status }, after: { status: "cancelled" } },
  });
}

/**
 * One click from "Suggested orders": a draft PO per vendor with the suggested quantities at each
 * item's current cost. Returns the new POs.
 */
export async function createSuggestedDrafts(tx: Tx, tenantId: number, vendorIds: number[], actor: StockActor) {
  const stock = await listStock(tenantId);
  const created: { id: number; number: number; vendorId: number }[] = [];
  for (const vendorId of vendorIds) {
    const items = stock
      .filter((s) => s.active && s.vendorId === vendorId)
      .map((s) => ({ s, qty: suggestedOrderQty({ ...s, onOrder: s.onOrder + s.onDraft }) }))
      .filter((x) => x.qty > 0);
    if (!items.length) continue;
    const [{ id: locationId } = { id: null }] = await tx.select({ id: locations.id }).from(locations).where(eq(locations.tenantId, tenantId)).orderBy(asc(locations.sortOrder), asc(locations.id)).limit(1);
    const po = await savePurchaseOrder(
      tx,
      tenantId,
      null,
      {
        vendorId,
        locationId,
        expectedOn: null,
        jobId: null,
        notes: null,
        shippingCents: 0,
        taxCents: 0,
        lines: items.map(({ s, qty }) => ({ materialId: s.id, description: s.name, quantity: qty, unit: s.unit, unitCostCents: s.unitCostCents, jobId: null })),
      },
      actor,
    );
    created.push({ ...po, vendorId });
  }
  return created;
}

/** Add or edit a vendor (name, contact, email, phone, account #). */
export async function saveVendor(
  tx: Tx,
  tenantId: number,
  id: number | null,
  v: { name: string; contactName: string | null; email: string | null; phone: string | null; accountNumber: string | null; website: string | null; notes: string | null },
  actor: StockActor,
) {
  if (!v.name.trim()) throw new UserError("Enter the vendor's name.");
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) throw new UserError("That email address doesn't look right.");
  const [dupe] = await tx
    .select({ id: vendors.id })
    .from(vendors)
    .where(and(eq(vendors.tenantId, tenantId), sql`lower(${vendors.name}) = ${v.name.trim().toLowerCase()}`, sql`${vendors.archivedAt} is null`, id ? sql`${vendors.id} <> ${id}` : undefined));
  if (dupe) throw new UserError(`There's already a vendor called “${v.name.trim()}”.`);
  const values = { ...v, name: v.name.trim() };
  if (id) {
    const [row] = await tx.update(vendors).set(values).where(and(eq(vendors.tenantId, tenantId), eq(vendors.id, id))).returning({ id: vendors.id });
    if (!row) throw new UserError("Vendor not found.");
    await logActivity({ tenantId, action: "vendor.updated", entityType: "setting", entityId: row.id, actorId: actor.id, summary: `Updated vendor ${values.name}` }, tx);
    return row.id;
  }
  const [row] = await tx.insert(vendors).values({ tenantId, ...values }).returning({ id: vendors.id });
  await logActivity({ tenantId, action: "vendor.created", entityType: "setting", entityId: row!.id, actorId: actor.id, summary: `Added vendor ${values.name}` }, tx);
  return row!.id;
}
