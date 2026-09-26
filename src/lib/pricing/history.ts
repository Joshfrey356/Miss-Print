import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * "What did we charge last time?" — historical price lookup.
 *
 * Today: SQL scoring (same category, similar size, similar quantity, trigram text match).
 * Later: add an embedding column on job_items and blend a semantic score in here (see lib/ai).
 */
export type SimilarJob = {
  jobId: number;
  number: number;
  title: string;
  customer: string;
  customerId: number;
  description: string;
  quantity: number;
  widthIn: number | null;
  heightIn: number | null;
  material: string | null;
  priceCents: number;
  date: string;
  category: string | null;
  score: number;
  close: boolean;
};

export type SimilarQuery = {
  categoryId?: number | null;
  widthIn?: number | null;
  heightIn?: number | null;
  quantity?: number | null;
  text?: string | null;
  customerId?: number | null;
  excludeJobId?: number | null;
  limit?: number;
};

export async function findSimilarJobs(tenantId: number, q: SimilarQuery): Promise<{ jobs: SimilarJob[]; stats: { count: number; avgCents: number; minCents: number; maxCents: number } | null }> {
  const area = q.widthIn && q.heightIn ? q.widthIn * q.heightIn : null;
  const qty = q.quantity && q.quantity > 0 ? q.quantity : null;
  const text = q.text?.trim() || null;
  const limit = q.limit ?? 8;

  const rows = await db.execute<{
    job_id: number;
    number: number;
    title: string;
    customer: string;
    customer_id: number;
    description: string;
    quantity: number;
    width_in: string | null;
    height_in: string | null;
    material: string | null;
    price_cents: number;
    date: string;
    category: string | null;
    score: number;
    close: boolean;
  }>(sql`
    with c as (
      select ji.*, j.number, j.title, j.id as jid, j.customer_id, cu.name as customer, pc.name as category,
             to_char(coalesce(j.completed_at, j.created_at) at time zone 'America/Chicago', 'YYYY-MM-DD') as date,
             (case when ${q.categoryId ?? null}::int is not null and ji.category_id = ${q.categoryId ?? null}::int then 3 else 0 end)
             + (case when ${area}::numeric is not null and ji.width_in is not null and ji.height_in is not null
                     then 3 * greatest(0, 1 - abs(ji.width_in * ji.height_in - ${area}::numeric) / greatest(${area}::numeric, 1)) else 0 end)
             + (case when ${qty}::int is not null and ji.quantity > 0
                     then 1.5 * greatest(0, 1 - abs(ln(ji.quantity::numeric / ${qty}::numeric)) / 1.5) else 0 end)
             + (case when ${text}::text is not null
                     then 4 * greatest(word_similarity(${text}::text, ji.description), word_similarity(${text}::text, j.title), word_similarity(${text}::text, coalesce(ji.specs, '')), word_similarity(${text}::text, coalesce(ji.material, '')))
                     else 0 end)
             + (case when ${q.customerId ?? null}::int is not null and j.customer_id = ${q.customerId ?? null}::int then 0.5 else 0 end)
             as score,
             ( (${q.categoryId ?? null}::int is null or ji.category_id = ${q.categoryId ?? null}::int)
               and (${area}::numeric is null or (ji.width_in is not null and abs(ji.width_in * ji.height_in - ${area}::numeric) <= 0.2 * ${area}::numeric))
               and (${qty}::int is null or ji.quantity between ${qty}::int * 0.67 and ${qty}::int * 1.5)
               and (${text}::text is null or ${q.categoryId ?? null}::int is not null or ${area}::numeric is not null
                    or greatest(word_similarity(${text}::text, ji.description), word_similarity(${text}::text, j.title), word_similarity(${text}::text, coalesce(ji.specs, ''))) >= 0.6)
             ) as close
      from job_items ji
      join jobs j on j.id = ji.job_id and j.tenant_id = ji.tenant_id
      join customers cu on cu.id = j.customer_id and cu.tenant_id = j.tenant_id
      left join product_categories pc on pc.id = ji.category_id and pc.tenant_id = ji.tenant_id
      where ji.tenant_id = ${tenantId} and j.archived_at is null and j.status <> 'cancelled' and ji.price_cents > 0
        and j.created_at > now() - interval '3 years'
        and (${q.excludeJobId ?? null}::int is null or j.id <> ${q.excludeJobId ?? null}::int)
        and (${q.categoryId ?? null}::int is null or ji.category_id = ${q.categoryId ?? null}::int
             or (${text}::text is not null and (${text}::text <% ji.description or ${text}::text <% j.title or ${text}::text <% coalesce(ji.specs, ''))))
    )
    select jid as job_id, number, title, customer, customer_id, description, quantity, width_in, height_in, material, price_cents, date, category, score::float as score, close
    from c
    order by close desc, score desc, date desc
    limit 60
  `);

  const all: SimilarJob[] = rows.map((r) => ({
    jobId: r.job_id,
    number: r.number,
    title: r.title,
    customer: r.customer,
    customerId: r.customer_id,
    description: r.description,
    quantity: r.quantity,
    widthIn: r.width_in != null ? Number(r.width_in) : null,
    heightIn: r.height_in != null ? Number(r.height_in) : null,
    material: r.material,
    priceCents: r.price_cents,
    date: r.date,
    category: r.category,
    score: r.score,
    close: r.close,
  }));
  const close = all.filter((r) => r.close && r.score > 0);
  const stats = close.length
    ? {
        count: close.length,
        avgCents: Math.round(close.reduce((a, r) => a + r.priceCents, 0) / close.length),
        minCents: Math.min(...close.map((r) => r.priceCents)),
        maxCents: Math.max(...close.map((r) => r.priceCents)),
      }
    : null;
  return { jobs: all.filter((r) => r.score > 0).slice(0, limit), stats };
}

/**
 * Parse a plain-English lookup like "4x8 banner", "Ford Transit wrap", "500 business cards".
 * Sizes: 4x8 → feet when both numbers ≤ 20 (large-format habit) unless marked with " or in.
 */
export function parseLookup(input: string): { widthIn: number | null; heightIn: number | null; quantity: number | null; text: string } {
  let text = input.trim();
  let widthIn: number | null = null;
  let heightIn: number | null = null;
  let quantity: number | null = null;
  const size = text.match(/(\d+(?:\.\d+)?)\s*(['"]|ft|in)?\s*[x×by]+\s*(\d+(?:\.\d+)?)\s*(['"]|ft|in)?/i);
  if (size) {
    const a = Number(size[1]);
    const b = Number(size[3]);
    const unit = (size[2] ?? size[4] ?? "").toLowerCase();
    const feet = unit === "'" || unit === "ft" || (unit === "" && a <= 20 && b <= 20 && !(a <= 12 && b <= 12 && /card|flyer|brochure|poster|letter|envelope/i.test(text)));
    widthIn = feet ? a * 12 : a;
    heightIn = feet ? b * 12 : b;
    text = text.replace(size[0], " ");
  }
  const qty = text.match(/\b(\d{1,3}(?:,\d{3})+|\d{2,6})\b/);
  if (qty) {
    quantity = Number(qty[1]!.replace(/,/g, ""));
    text = text.replace(qty[0], " ");
  }
  text = text.replace(/\b(show me|every|all|we have|sold|previous|past|for|the|of|did|we|do|what)\b/gi, " ").replace(/\s+/g, " ").trim();
  return { widthIn, heightIn, quantity, text };
}
