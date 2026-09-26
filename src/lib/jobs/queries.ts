import "server-only";
import { aliasedTable, and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activityLogs,
  customerContacts,
  customers,
  files,
  invoices,
  jobItems,
  jobStatusHistory,
  jobs,
  locations,
  productCategories,
  proofs,
  users,
  type JobStatus,
} from "@/lib/db/schema";
import { addDays, fmtSize, today } from "@/lib/format";
import { ACTIVE_STATUSES, BOARD_COLUMNS, OPEN_STATUSES, READY_STATUSES, WORK_STATUSES } from "@/lib/jobs/workflow";
import type { SessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";

const designer = aliasedTable(users, "designer");
const producer = aliasedTable(users, "producer");
const installer = aliasedTable(users, "installer");
const sales = aliasedTable(users, "sales");

/** Person responsible for the job's current stage. */
function ownerFor(status: JobStatus, j: { designer?: string | null; production?: string | null; installer?: string | null; sales?: string | null }) {
  if (["design", "proof_ready", "waiting_approval", "waiting_artwork"].includes(status)) return j.designer ?? j.sales;
  if (["approved_for_production", "production", "finishing", "quality_check"].includes(status)) return j.production;
  if (status === "scheduled_install") return j.installer;
  return j.sales;
}

export type JobFilter = {
  q?: string;
  view?: string; // open | today | week | overdue | rush | mine | waiting | ready | completed | all | hold
  location?: string; // location code
  assignee?: number;
  department?: string; // front | design | production | install
  category?: number;
  sort?: string;
  dir?: string;
  page?: number;
};

export const JOB_VIEWS: { key: string; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "today", label: "Due today" },
  { key: "week", label: "This week" },
  { key: "overdue", label: "Overdue" },
  { key: "rush", label: "Rush" },
  { key: "mine", label: "Mine" },
  { key: "waiting", label: "Waiting on customer" },
  { key: "ready", label: "Ready" },
  { key: "hold", label: "On hold" },
  { key: "completed", label: "Completed" },
  { key: "all", label: "All" },
];

function filterWhere(f: JobFilter, user: SessionUser): SQL[] {
  const t = today();
  const w: SQL[] = [isNull(jobs.archivedAt)];
  switch (f.view ?? "open") {
    case "open":
      w.push(inArray(jobs.status, OPEN_STATUSES));
      break;
    case "today":
      w.push(inArray(jobs.status, ACTIVE_STATUSES), lte(jobs.dueDate, t));
      break;
    case "week":
      w.push(inArray(jobs.status, ACTIVE_STATUSES), lte(jobs.dueDate, addDays(t, 7)));
      break;
    case "overdue":
      w.push(inArray(jobs.status, WORK_STATUSES), lt(jobs.dueDate, t));
      break;
    case "rush":
      w.push(inArray(jobs.status, OPEN_STATUSES), ne(jobs.priority, "normal"));
      break;
    case "mine":
      w.push(
        inArray(jobs.status, OPEN_STATUSES),
        or(eq(jobs.designerId, user.id), eq(jobs.productionId, user.id), eq(jobs.installerId, user.id), eq(jobs.salespersonId, user.id))!,
      );
      break;
    case "waiting":
      w.push(inArray(jobs.status, ["quote_sent", "waiting_artwork", "waiting_approval"]));
      break;
    case "ready":
      w.push(inArray(jobs.status, READY_STATUSES));
      break;
    case "hold":
      w.push(eq(jobs.status, "on_hold"));
      break;
    case "noart":
      w.push(
        inArray(jobs.status, ["approved_for_production", "production"]),
        sql`not exists (select 1 from ${files} f where f.job_id = ${jobs.id} and f.folder in ('original_artwork','customer','production') and f.archived_at is null)`,
      );
      break;
    case "proofs":
      w.push(inArray(jobs.status, ["proof_ready", "waiting_approval"]));
      break;
    case "completed":
      w.push(eq(jobs.status, "completed"));
      break;
    case "all":
      break;
  }
  if (f.location) w.push(eq(locations.code, f.location));
  if (f.assignee)
    w.push(or(eq(jobs.designerId, f.assignee), eq(jobs.productionId, f.assignee), eq(jobs.installerId, f.assignee), eq(jobs.salespersonId, f.assignee))!);
  if (f.category) w.push(eq(jobs.categoryId, f.category));
  if (f.department) {
    const statuses = BOARD_COLUMNS.filter((c) => c.department === f.department).flatMap((c) => c.statuses);
    if (statuses.length) w.push(inArray(jobs.status, statuses));
  }
  if (f.q?.trim()) {
    const q = f.q.trim();
    const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    const num = q.match(/^(?:mp)?[-\s#]?(\d{4,7})$/i)?.[1];
    w.push(
      or(
        num ? eq(jobs.number, Number(num)) : undefined,
        ilike(jobs.title, like),
        ilike(customers.name, like),
        ilike(jobs.description, like),
        ilike(jobs.poNumber, like),
        sql`exists (select 1 from ${jobItems} ji where ji.job_id = ${jobs.id} and (ji.description ilike ${like} or ji.material ilike ${like} or ji.specs ilike ${like}))`,
      )!,
    );
  }
  return w;
}

const jobCardSelect = {
  id: jobs.id,
  number: jobs.number,
  title: jobs.title,
  status: jobs.status,
  priority: jobs.priority,
  dueDate: jobs.dueDate,
  fulfillment: jobs.fulfillment,
  fulfillmentAt: jobs.fulfillmentAt,
  boardOrder: jobs.boardOrder,
  totalCents: jobs.totalCents,
  completedAt: jobs.completedAt,
  createdAt: jobs.createdAt,
  customerId: customers.id,
  customer: customers.name,
  locationCode: locations.code,
  locationName: locations.name,
  categoryName: productCategories.name,
  designer: designer.name,
  designerColor: designer.color,
  production: producer.name,
  productionColor: producer.color,
  installer: installer.name,
  installerColor: installer.color,
  sales: sales.name,
  salesColor: sales.color,
  firstItem: sql<{ q: number; w: string | null; h: string | null; m: string | null } | null>`(select json_build_object('q', ji.quantity, 'w', ji.width_in, 'h', ji.height_in, 'm', ji.material) from ${jobItems} ji where ji.job_id = ${jobs.id} order by ji.sort_order, ji.id limit 1)`,
  hasArtwork: sql<boolean>`exists (select 1 from ${files} f where f.job_id = ${jobs.id} and f.folder in ('original_artwork','customer','production') and f.archived_at is null)`,
};

function baseJobQuery() {
  return db
    .select(jobCardSelect)
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .leftJoin(locations, eq(locations.id, jobs.locationId))
    .leftJoin(productCategories, eq(productCategories.id, jobs.categoryId))
    .leftJoin(designer, eq(designer.id, jobs.designerId))
    .leftJoin(producer, eq(producer.id, jobs.productionId))
    .leftJoin(installer, eq(installer.id, jobs.installerId))
    .leftJoin(sales, eq(sales.id, jobs.salespersonId))
    .$dynamic();
}

export type JobCard = Awaited<ReturnType<typeof listJobs>>["rows"][number];

function summarize(i: { q: number; w: string | null; h: string | null; m: string | null } | null) {
  if (!i) return null;
  return [i.q > 1 ? `${i.q.toLocaleString()} pcs` : null, fmtSize(i.w ? Number(i.w) : null, i.h ? Number(i.h) : null) || null, i.m].filter(Boolean).join(" · ") || null;
}

function decorate<T extends { firstItem: { q: number; w: string | null; h: string | null; m: string | null } | null; status: JobStatus; dueDate: string | null; designer: string | null; production: string | null; installer: string | null; sales: string | null; designerColor: string | null; productionColor: string | null; installerColor: string | null; salesColor: string | null; totalCents: number }>(rows: T[], user: SessionUser) {
  const t = today();
  const showMoney = can(user.role, "financials.view");
  return rows.map((r) => {
    const owner = ownerFor(r.status, r);
    const ownerColor =
      owner === r.designer ? r.designerColor : owner === r.production ? r.productionColor : owner === r.installer ? r.installerColor : r.salesColor;
    return {
      ...r,
      itemSummary: summarize(r.firstItem),
      totalCents: showMoney ? r.totalCents : null,
      owner: owner ?? null,
      ownerColor: ownerColor ?? null,
      overdue: !!r.dueDate && r.dueDate < t && WORK_STATUSES.includes(r.status),
    };
  });
}

export async function listJobs(f: JobFilter, user: SessionUser) {
  const pageSize = 30;
  const page = Math.max(1, f.page ?? 1);
  const where = and(...filterWhere(f, user));
  const dir = f.dir === "desc" ? desc : asc;
  const order =
    f.sort === "number" ? [dir(jobs.number)] :
    f.sort === "customer" ? [dir(customers.name)] :
    f.sort === "status" ? [dir(jobs.status)] :
    f.sort === "total" && can(user.role, "financials.view") ? [dir(jobs.totalCents)] :
    f.sort === "created" ? [dir(jobs.createdAt)] :
    (f.view === "completed" || f.view === "all") && !f.sort ? [desc(jobs.completedAt), desc(jobs.number)] :
    [sql`${jobs.dueDate} ${f.dir === "desc" ? sql`desc` : sql`asc`} nulls last`, desc(jobs.priority), asc(jobs.number)];
  const [rows, [{ n }]] = await Promise.all([
    baseJobQuery().where(where).orderBy(...order).limit(pageSize).offset((page - 1) * pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(jobs)
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .leftJoin(locations, eq(locations.id, jobs.locationId))
      .where(where),
  ]);
  return { rows: decorate(rows, user), total: n, page, pageSize };
}

/** Jobs for the production board: all open jobs (not on hold/cancelled) + completed in the last 7 days. */
export async function boardJobs(user: SessionUser) {
  const since = new Date(Date.now() - 7 * 86400000);
  const rows = await baseJobQuery()
    .where(
      and(
        isNull(jobs.archivedAt),
        or(
          and(inArray(jobs.status, OPEN_STATUSES), ne(jobs.status, "on_hold")),
          and(eq(jobs.status, "completed"), gte(jobs.completedAt, since)),
        ),
      ),
    )
    .orderBy(asc(jobs.boardOrder), sql`${jobs.dueDate} asc nulls last`, desc(jobs.priority));
  return decorate(rows, user);
}

/** Everything the job page needs. Money fields are removed for roles that can't see them. */
export async function getJobDetail(number: number, user: SessionUser) {
  const [row] = await db
    .select({
      job: jobs,
      customer: {
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        email: customers.email,
        taxExempt: customers.taxExempt,
        poRequired: customers.poRequired,
        paymentTerms: customers.paymentTerms,
        discountPct: customers.discountPct,
        notes: customers.notes,
      },
      contact: { id: customerContacts.id, name: customerContacts.name, phone: customerContacts.phone, email: customerContacts.email },
      location: { id: locations.id, code: locations.code, name: locations.name },
      category: { id: productCategories.id, name: productCategories.name, slug: productCategories.slug, group: productCategories.group },
      quoteNumber: sql<number | null>`(select q.number from quotes q where q.id = ${jobs.quoteId})`,
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .leftJoin(customerContacts, eq(customerContacts.id, jobs.contactId))
    .leftJoin(locations, eq(locations.id, jobs.locationId))
    .leftJoin(productCategories, eq(productCategories.id, jobs.categoryId))
    .where(eq(jobs.number, number));
  if (!row) return null;
  const jobId = row.job.id;

  const [items, fileRows, proofRows, history, activity, invoiceRows, contacts, reorderOf] = await Promise.all([
    db.select().from(jobItems).where(eq(jobItems.jobId, jobId)).orderBy(asc(jobItems.sortOrder), asc(jobItems.id)),
    db
      .select({ id: files.id, folder: files.folder, filename: files.filename, mimeType: files.mimeType, sizeBytes: files.sizeBytes, preflightStatus: files.preflightStatus, preflight: files.preflight, createdAt: files.createdAt, uploadedBy: users.name })
      .from(files)
      .leftJoin(users, eq(users.id, files.uploadedBy))
      .where(and(eq(files.jobId, jobId), isNull(files.archivedAt)))
      .orderBy(desc(files.createdAt)),
    db
      .select({ proof: proofs, filename: files.filename, mimeType: files.mimeType, sentByName: users.name })
      .from(proofs)
      .innerJoin(files, eq(files.id, proofs.fileId))
      .leftJoin(users, eq(users.id, proofs.sentBy))
      .where(eq(proofs.jobId, jobId))
      .orderBy(desc(proofs.version)),
    db
      .select({ id: jobStatusHistory.id, from: jobStatusHistory.fromStatus, to: jobStatusHistory.toStatus, at: jobStatusHistory.changedAt, by: users.name, note: jobStatusHistory.note })
      .from(jobStatusHistory)
      .leftJoin(users, eq(users.id, jobStatusHistory.changedBy))
      .where(eq(jobStatusHistory.jobId, jobId))
      .orderBy(desc(jobStatusHistory.changedAt)),
    db
      .select({ id: activityLogs.id, action: activityLogs.action, summary: activityLogs.summary, data: activityLogs.data, at: activityLogs.createdAt, by: users.name, byColor: users.color })
      .from(activityLogs)
      .leftJoin(users, eq(users.id, activityLogs.actorId))
      .where(eq(activityLogs.jobId, jobId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(200),
    can(user.role, "money.view") || can(user.role, "financials.view")
      ? db
          .select({ id: invoices.id, number: invoices.number, status: invoices.status, totalCents: invoices.totalCents, paidCents: invoices.paidCents, dueDate: invoices.dueDate, issueDate: invoices.issueDate })
          .from(invoices)
          .where(eq(invoices.jobId, jobId))
          .orderBy(desc(invoices.createdAt))
      : Promise.resolve([]),
    db
      .select({ id: customerContacts.id, name: customerContacts.name })
      .from(customerContacts)
      .where(and(eq(customerContacts.customerId, row.customer.id), isNull(customerContacts.archivedAt))),
    row.job.reorderOfJobId
      ? db.select({ number: jobs.number, title: jobs.title }).from(jobs).where(eq(jobs.id, row.job.reorderOfJobId))
      : Promise.resolve([]),
  ]);

  const showMoney = can(user.role, "financials.view");
  const showCost = can(user.role, "margins.view");
  const job = { ...row.job };
  if (!showMoney) Object.assign(job, { subtotalCents: 0, taxCents: 0, totalCents: 0 });
  if (!showCost) Object.assign(job, { estimatedCostCents: 0 });
  const cleanItems = items.map((i) => ({
    ...i,
    priceCents: showMoney ? i.priceCents : 0,
    recommendedCents: showMoney ? i.recommendedCents : 0,
    overrideReason: showMoney ? i.overrideReason : null,
    estimatedCostCents: showCost ? i.estimatedCostCents : 0,
    pricingInput: showCost ? i.pricingInput : null,
  }));
  const MONEY_ACTIONS = ["quote.price_changed", "job.price_changed", "invoice.created", "invoice.reminder_sent", "payment.received", "invoice.voided", "payment.voided"];
  // Expenses are costs: hidden from everyone without margins.view (incl. managers/sales).
  const COST_ACTIONS = ["expense.created", "expense.updated", "expense.archived"];
  const cleanActivity = activity
    .filter((a) => (showMoney || !MONEY_ACTIONS.includes(a.action)) && (showCost || !COST_ACTIONS.includes(a.action)))
    // Some summaries carry an amount, e.g. "Added item: Banner ($120.00)".
    .map((a) => ({ ...a, summary: showMoney ? a.summary : a.summary.replace(/\s*\(-?\$[\d,]+(?:\.\d+)?\)/g, ""), data: showMoney && showCost ? a.data : null }));
  // The token hash never needs to leave the server.
  const cleanProofs = proofRows.map(({ proof: { tokenHash: _t, ...proof }, ...rest }) => ({ ...rest, proof }));

  return {
    ...row,
    job,
    items: cleanItems,
    files: fileRows,
    proofs: cleanProofs,
    history,
    activity: cleanActivity,
    invoices: invoiceRows,
    contacts,
    reorderOf: reorderOf[0] ?? null,
    canSeeMoney: showMoney,
    canSeeCost: showCost,
  };
}
export type JobDetail = NonNullable<Awaited<ReturnType<typeof getJobDetail>>>;

/** Counts for the Jobs view chips. */
export async function jobViewCounts(user: SessionUser) {
  const t = today();
  const [r] = await db
    .select({
      open: sql<number>`count(*) filter (where ${inArray(jobs.status, OPEN_STATUSES)})::int`,
      today: sql<number>`count(*) filter (where ${inArray(jobs.status, ACTIVE_STATUSES)} and ${jobs.dueDate} <= ${t})::int`,
      overdue: sql<number>`count(*) filter (where ${inArray(jobs.status, WORK_STATUSES)} and ${jobs.dueDate} < ${t})::int`,
      rush: sql<number>`count(*) filter (where ${inArray(jobs.status, OPEN_STATUSES)} and ${jobs.priority} <> 'normal')::int`,
      mine: sql<number>`count(*) filter (where ${inArray(jobs.status, OPEN_STATUSES)} and (${jobs.designerId} = ${user.id} or ${jobs.productionId} = ${user.id} or ${jobs.installerId} = ${user.id} or ${jobs.salespersonId} = ${user.id}))::int`,
      waiting: sql<number>`count(*) filter (where ${inArray(jobs.status, ["quote_sent", "waiting_artwork", "waiting_approval"])})::int`,
      ready: sql<number>`count(*) filter (where ${inArray(jobs.status, READY_STATUSES)})::int`,
      hold: sql<number>`count(*) filter (where ${jobs.status} = 'on_hold')::int`,
    })
    .from(jobs)
    .where(isNull(jobs.archivedAt));
  return r!;
}

/** Last N jobs of a customer (for reorder hints etc.) */
export async function recentCustomerJobs(customerId: number, limit = 5) {
  return db
    .select({ id: jobs.id, number: jobs.number, title: jobs.title, status: jobs.status, completedAt: jobs.completedAt })
    .from(jobs)
    .where(and(eq(jobs.customerId, customerId), isNull(jobs.archivedAt), isNotNull(jobs.number), notInArray(jobs.status, ["cancelled"])))
    .orderBy(desc(jobs.createdAt))
    .limit(limit);
}
