/**
 * Job costing from purchasing & stock, as ONE SQL definition used everywhere a job's actual cost is
 * worked out: the job page (src/lib/jobs/profit.ts), Money → Profitability (src/lib/money/queries.ts)
 * and the profit reports (src/lib/reports/queries.ts). Same rule as jobPurchaseCosts() in ./math
 * (the readable reference, unit-tested against this SQL in tests/inventory-cost-sql.test.ts):
 *
 * - purchase-order lines charged to the job — by the line's job, else the PO's job — on ordered,
 *   partly received or received POs: stock lines → materials, free-text lines → outside services;
 * - shipping + tax of POs that are wholly for one job → outside services;
 * - stock "use" movements on the job at the material's cost (paper: cost per 1,000 ÷ 1,000), minus
 *   the quantity of that material bought on the job's own PO lines (so it isn't counted twice).
 *
 * No "server-only": it only builds SQL. Every table is filtered by tenant_id by hand.
 */
import { sql, type SQL } from "drizzle-orm";
import { inventoryMovements, materials, purchaseOrderItems, purchaseOrders } from "@/lib/db/schema";

/** A condition on a job-id column, e.g. `(col) => sql\`${col} = ${jobId}\``, to cost only some jobs. */
export type JobScope = (col: SQL) => SQL;

/**
 * A full SELECT (with its own WITH) returning one row per job that has any of these costs:
 * job_id, stock_cents, purchased_material_cents, po_outside_cents (all int). Use it as a CTE:
 *   sql`with pc as (${jobPurchaseCostsSql(tenantId)}) select … left join pc on pc.job_id = j.id`
 */
export function jobPurchaseCostsSql(tenantId: number, scope?: JobScope): SQL {
  const lineJob = sql`coalesce(i.job_id, p.job_id)`;
  const inScope = (col: SQL) => (scope ? sql` and ${scope(col)}` : sql``);
  return sql`
    with pl as (
      select ${lineJob} as job_id, i.material_id, i.quantity, i.amount_cents
      from ${purchaseOrderItems} i
      join ${purchaseOrders} p on p.tenant_id = i.tenant_id and p.id = i.purchase_order_id
      where i.tenant_id = ${tenantId} and p.tenant_id = ${tenantId}
        and p.status in ('ordered', 'partial', 'received') and ${lineJob} is not null${inScope(lineJob)}
    ), ex as (
      select p.job_id, sum(p.shipping_cents + p.tax_cents) as cents
      from ${purchaseOrders} p
      where p.tenant_id = ${tenantId} and p.job_id is not null and p.status in ('ordered', 'partial', 'received')${inScope(sql`p.job_id`)}
      group by p.job_id
    ), bought as (
      select job_id, material_id, sum(quantity) as qty from pl where material_id is not null group by job_id, material_id
    ), used as (
      select m.job_id, m.material_id, -sum(m.quantity) as qty
      from ${inventoryMovements} m
      where m.tenant_id = ${tenantId} and m.kind = 'use' and m.job_id is not null${inScope(sql`m.job_id`)}
      group by m.job_id, m.material_id
      having -sum(m.quantity) > 0
    ), stock as (
      select u.job_id,
        round(sum(greatest(u.qty - coalesce(b.qty, 0), 0) *
          (case when mt.unit = 'sheet' and mt.cost_per_m_cents is not null then mt.cost_per_m_cents / 1000.0 else mt.cost_cents end)))::int as cents
      from used u
      join ${materials} mt on mt.tenant_id = ${tenantId} and mt.id = u.material_id
      left join bought b on b.job_id = u.job_id and b.material_id = u.material_id
      group by u.job_id
    ), pls as (
      select job_id,
        coalesce(sum(amount_cents) filter (where material_id is not null), 0) as material_cents,
        coalesce(sum(amount_cents) filter (where material_id is null), 0) as outside_cents
      from pl group by job_id
    ), ids as (
      select job_id from pls union select job_id from ex union select job_id from stock
    )
    select ids.job_id,
      coalesce(stock.cents, 0)::int as stock_cents,
      coalesce(pls.material_cents, 0)::int as purchased_material_cents,
      (coalesce(pls.outside_cents, 0) + coalesce(ex.cents, 0))::int as po_outside_cents
    from ids
    left join stock on stock.job_id = ids.job_id
    left join pls on pls.job_id = ids.job_id
    left join ex on ex.job_id = ids.job_id`;
}

export type JobPurchaseCostRow = { job_id: number; stock_cents: number; purchased_material_cents: number; po_outside_cents: number };
