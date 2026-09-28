/**
 * The job-costing SQL (src/lib/inventory/cost-sql.ts), used by the job page, Money → Profitability and
 * the profit reports, must give the same numbers as the readable rule jobPurchaseCosts() in
 * src/lib/inventory/math.ts. Runs the SQL on an in-memory Postgres (PGlite) with the columns it reads.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { jobPurchaseCostsSql, type JobPurchaseCostRow } from "../src/lib/inventory/cost-sql";
import { jobPurchaseCosts, unitCostOf, type CostPoLine, type CostUse } from "../src/lib/inventory/math";

type Mat = { id: number; tenant: number; unit: string; costCents: number; costPerMCents: number | null };
type Po = { id: number; tenant: number; jobId: number | null; status: string; shipping: number; tax: number };
type Line = { tenant: number; poId: number; materialId: number | null; quantity: number; amountCents: number; jobId: number | null };
type Move = { tenant: number; materialId: number; kind: string; quantity: number; jobId: number | null };

const mats: Mat[] = [
  { id: 1, tenant: 1, unit: "sheet", costCents: 8, costPerMCents: 8000 }, // 100# gloss text: 8¢/sheet
  { id: 2, tenant: 1, unit: "sheet", costCents: 1, costPerMCents: 1200 }, // 20# bond: 1.2¢/sheet (sub-cent)
  { id: 3, tenant: 1, unit: "sqft", costCents: 55, costPerMCents: null }, // banner vinyl
  { id: 9, tenant: 2, unit: "sheet", costCents: 500, costPerMCents: 500000 }, // another shop
];
const pos: Po[] = [
  { id: 1, tenant: 1, jobId: 10, status: "received", shipping: 2500, tax: 700 }, // wholly for job 10
  { id: 2, tenant: 1, jobId: null, status: "partial", shipping: 999, tax: 0 }, // stock order, one line for job 11
  { id: 3, tenant: 1, jobId: 10, status: "draft", shipping: 5000, tax: 0 }, // draft: not a cost yet
  { id: 4, tenant: 1, jobId: 11, status: "cancelled", shipping: 100, tax: 0 }, // cancelled: not a cost
  { id: 5, tenant: 2, jobId: 10, status: "ordered", shipping: 7777, tax: 0 }, // another shop's job 10
];
const lines: Line[] = [
  { tenant: 1, poId: 1, materialId: 1, quantity: 2500, amountCents: 20000, jobId: null }, // paper bought for job 10
  { tenant: 1, poId: 1, materialId: null, quantity: 1, amountCents: 18000, jobId: null }, // die cutting for job 10
  { tenant: 1, poId: 2, materialId: 2, quantity: 5000, amountCents: 6000, jobId: null }, // plain stock
  { tenant: 1, poId: 2, materialId: null, quantity: 1, amountCents: 4200, jobId: 11 }, // outside work charged to job 11
  { tenant: 1, poId: 3, materialId: 3, quantity: 100, amountCents: 5500, jobId: null },
  { tenant: 1, poId: 4, materialId: null, quantity: 1, amountCents: 900, jobId: null },
  { tenant: 2, poId: 5, materialId: 9, quantity: 10, amountCents: 5000, jobId: null },
];
const moves: Move[] = [
  { tenant: 1, materialId: 1, kind: "use", quantity: -2000, jobId: 10 },
  { tenant: 1, materialId: 1, kind: "use", quantity: -600, jobId: 10 }, // 2,600 used, 2,500 bought → 100 from stock
  { tenant: 1, materialId: 3, kind: "use", quantity: -64, jobId: 10 },
  { tenant: 1, materialId: 2, kind: "use", quantity: -265, jobId: 11 }, // 265 × 1.2¢ = 318
  { tenant: 1, materialId: 2, kind: "use", quantity: -35, jobId: 12 },
  { tenant: 1, materialId: 2, kind: "receive", quantity: 5000, jobId: 12 }, // receipts aren't job cost
  { tenant: 1, materialId: 3, kind: "adjust", quantity: -10, jobId: 12 },
  { tenant: 2, materialId: 9, kind: "use", quantity: -3, jobId: 10 }, // another shop
];

/** The same numbers the way src/lib/jobs/profit.ts described them in TypeScript. */
function expected(tenant: number, jobId: number) {
  const counted = new Set(["ordered", "partial", "received"]);
  const poLines: CostPoLine[] = lines
    .filter((l) => l.tenant === tenant)
    .map((l) => ({ l, po: pos.find((p) => p.id === l.poId && p.tenant === tenant)! }))
    .filter(({ l, po }) => counted.has(po.status) && (l.jobId ?? po.jobId) === jobId)
    .map(({ l }) => ({ materialId: l.materialId, quantity: l.quantity, amountCents: l.amountCents }));
  const extras = pos.filter((p) => p.tenant === tenant && p.jobId === jobId && counted.has(p.status)).reduce((a, p) => a + p.shipping + p.tax, 0);
  const used = new Map<number, number>();
  for (const m of moves) if (m.tenant === tenant && m.jobId === jobId && m.kind === "use") used.set(m.materialId, (used.get(m.materialId) ?? 0) - m.quantity);
  const uses: CostUse[] = [...used].filter(([, q]) => q > 0).map(([id, q]) => ({ materialId: id, quantity: q, unitCostCents: unitCostOf(mats.find((x) => x.id === id)!) }));
  const r = jobPurchaseCosts(poLines, uses, extras);
  return { stock_cents: r.stockCents, purchased_material_cents: r.purchasedMaterialCents, po_outside_cents: r.outsideCents };
}

test("job costing SQL matches jobPurchaseCosts(), per job and per shop", async () => {
  const client = new PGlite();
  const db = drizzle(client);
  await client.exec(`
    create table materials (id int, tenant_id int, unit text, cost_cents int, cost_per_m_cents int);
    create table purchase_orders (id int, tenant_id int, job_id int, status text, shipping_cents int, tax_cents int);
    create table purchase_order_items (id serial, tenant_id int, purchase_order_id int, material_id int, quantity numeric(12,2), amount_cents int, job_id int);
    create table inventory_movements (id serial, tenant_id int, material_id int, kind text, quantity numeric(12,2), job_id int);
  `);
  for (const m of mats) await client.query("insert into materials values ($1,$2,$3,$4,$5)", [m.id, m.tenant, m.unit, m.costCents, m.costPerMCents]);
  for (const p of pos) await client.query("insert into purchase_orders values ($1,$2,$3,$4,$5,$6)", [p.id, p.tenant, p.jobId, p.status, p.shipping, p.tax]);
  for (const l of lines)
    await client.query("insert into purchase_order_items (tenant_id, purchase_order_id, material_id, quantity, amount_cents, job_id) values ($1,$2,$3,$4,$5,$6)", [l.tenant, l.poId, l.materialId, l.quantity, l.amountCents, l.jobId]);
  for (const m of moves) await client.query("insert into inventory_movements (tenant_id, material_id, kind, quantity, job_id) values ($1,$2,$3,$4,$5)", [m.tenant, m.materialId, m.kind, m.quantity, m.jobId]);

  const run = async (tenant: number, scope?: (col: ReturnType<typeof sql>) => ReturnType<typeof sql>) => {
    const res = (await db.execute(jobPurchaseCostsSql(tenant, scope))) as unknown as { rows: JobPurchaseCostRow[] };
    return new Map(res.rows.map((r) => [Number(r.job_id), { stock_cents: Number(r.stock_cents), purchased_material_cents: Number(r.purchased_material_cents), po_outside_cents: Number(r.po_outside_cents) }]));
  };

  const all = await run(1);
  assert.deepEqual([...all.keys()].sort(), [10, 11, 12]);
  for (const job of [10, 11, 12]) assert.deepEqual(all.get(job), expected(1, job), `job ${job}`);
  // Spelled out for job 10: 100 extra sheets × 8¢ + 64 sq ft × 55¢; $200 paper; $180 die cutting + $25 shipping + $7 tax.
  assert.deepEqual(all.get(10), { stock_cents: 800 + 3520, purchased_material_cents: 20000, po_outside_cents: 18000 + 2500 + 700 });
  assert.deepEqual(all.get(11), { stock_cents: 318, purchased_material_cents: 0, po_outside_cents: 4200 });

  // Scoped to one job (the job page) — same numbers.
  const one = await run(1, (col) => sql`${col} = ${10}`);
  assert.deepEqual([...one.keys()], [10]);
  assert.deepEqual(one.get(10), all.get(10));

  // Another shop sees only its own rows: the 3 sheets it used on its job 10 are covered by the 10 bought on its PO.
  const other = await run(2);
  assert.deepEqual(other.get(10), expected(2, 10));
  assert.deepEqual(other.get(10), { stock_cents: 0, purchased_material_cents: 5000, po_outside_cents: 7777 });
  await client.close();
});
