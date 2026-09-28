import "server-only";
import { and, asc, desc, eq, inArray, isNull, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { customerContacts, customers, imports, jobItems, jobStatusHistory, jobs, materials, productCategories, tenants, vendors } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { UserError } from "@/lib/actions";
import { today } from "@/lib/format";
import { KINDS, type ImportKind } from "./fields";
import { NAME_SUFFIX_RE, nameKey } from "./parse";
import { normalizeContact, normalizeCustomer, normalizeJob, normalizeMaterial, normalizeVendor, type ImportSummary, type JobValues } from "./records";

/**
 * Settings → Import: saving rows the browser has already read and mapped. The browser sends the
 * mapped cells as text in chunks; each chunk is re-validated here (normalizeRow) and saved in one
 * transaction. Every row created carries the import's id, so the whole import can be undone
 * (archived, never deleted).
 */

export type { ImportSummary };

export type ChunkRow = { row: number; values: Record<string, string> };

type Ctx = { tenantId: number; userId: number; importId: number; filename: string };

const MAX_ERRORS = 2000;
const SINGULAR = { jobs: "job", contacts: "contact", customers: "customer", materials: "material", vendors: "vendor" };
const emptySummary = (): ImportSummary => ({ created: 0, updated: 0, skipped: 0, errors: [], extra: {} });

/** Same key as nameKey(), in SQL, for matching names regardless of case and punctuation. */
const keySql = (col: AnyColumn) =>
  sql<string>`coalesce(nullif(regexp_replace(btrim(regexp_replace(replace(lower(${col}), '&', ' and '), '[^a-z0-9]+', ' ', 'g')), ${NAME_SUFFIX_RE}, ''), ''), lower(btrim(${col})))`;
const matchKey = (name: string) => nameKey(name) || name.toLowerCase().trim();
const uniq = <T>(xs: (T | null | undefined)[]) => [...new Set(xs.filter((x): x is T => x != null && x !== ""))];
const bump = (t: ImportSummary, k: keyof NonNullable<ImportSummary["extra"]>, n = 1) => {
  t.extra ??= {};
  t.extra[k] = (t.extra[k] ?? 0) + n;
};

/** Fields of `incoming` that are filled in where `current` is blank. */
function blanks<T extends Record<string, unknown>>(current: T, incoming: Partial<T>): Partial<T> {
  const patch: Partial<T> = {};
  for (const [k, v] of Object.entries(incoming) as [keyof T, T[keyof T]][]) {
    if (v == null || v === "") continue;
    const cur = current[k];
    if (cur == null || cur === "") patch[k] = v;
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Import lifecycle
// ---------------------------------------------------------------------------
export async function startImport(tenantId: number, userId: number, kind: ImportKind, filename: string) {
  const [row] = await db
    .insert(imports)
    .values({ tenantId, kind, filename: filename.slice(0, 200) || "spreadsheet", summary: emptySummary(), createdBy: userId })
    .returning({ id: imports.id });
  return row!.id;
}

async function lockImport(tx: Tx, tenantId: number, importId: number) {
  const [imp] = await tx
    .select()
    .from(imports)
    .where(and(eq(imports.tenantId, tenantId), eq(imports.id, importId)))
    .for("update");
  if (!imp) throw new UserError("That import wasn't found.");
  return imp;
}

/** Save one chunk of rows. Returns the import's running totals. */
export async function importChunk(tenantId: number, userId: number, importId: number, kind: ImportKind, rows: ChunkRow[]): Promise<ImportSummary> {
  return db.transaction(async (tx) => {
    const imp = await lockImport(tx, tenantId, importId);
    if (imp.kind !== kind) throw new UserError("That import is for something else.");
    if (imp.undoneAt) throw new UserError("This import was undone.");
    const ctx: Ctx = { tenantId, userId, importId, filename: imp.filename };
    const t = emptySummary();
    if (kind === "customers") await importCustomers(tx, ctx, rows, t);
    else if (kind === "contacts") await importContacts(tx, ctx, rows, t);
    else if (kind === "jobs") await importJobs(tx, ctx, rows, t);
    else if (kind === "materials") await importMaterials(tx, ctx, rows, t);
    else await importVendors(tx, ctx, rows, t);

    const prev = imp.summary as ImportSummary;
    const extra = { ...(prev.extra ?? {}) };
    for (const [k, v] of Object.entries(t.extra ?? {}) as [keyof NonNullable<ImportSummary["extra"]>, number][]) extra[k] = (extra[k] ?? 0) + v;
    const summary: ImportSummary = {
      created: prev.created + t.created,
      updated: prev.updated + t.updated,
      skipped: prev.skipped + t.skipped,
      errors: [...prev.errors, ...t.errors].slice(0, MAX_ERRORS),
      extra,
    };
    await tx
      .update(imports)
      .set({ summary })
      .where(and(eq(imports.tenantId, tenantId), eq(imports.id, importId)));
    return summary;
  });
}

/** Called once after the last chunk: records the import in the activity log. */
export async function finishImport(tenantId: number, userId: number, importId: number): Promise<ImportSummary> {
  const [imp] = await db
    .select()
    .from(imports)
    .where(and(eq(imports.tenantId, tenantId), eq(imports.id, importId)));
  if (!imp) throw new UserError("That import wasn't found.");
  const s = imp.summary as ImportSummary;
  const noun = KINDS[imp.kind].noun;
  await logActivity({
    tenantId,
    action: "import.completed",
    entityType: "setting",
    entityId: imp.id,
    actorId: userId,
    summary: `Imported ${noun} from ${imp.filename}: ${s.created} added, ${s.updated} updated, ${s.skipped} skipped, ${s.errors.length} with problems`,
    data: {
      importId: imp.id,
      kind: imp.kind,
      filename: imp.filename,
      created: s.created,
      updated: s.updated,
      skipped: s.skipped,
      errors: s.errors.length,
      extra: s.extra ?? {},
    },
  });
  return s;
}

/**
 * Undo an import: archive every customer, contact, vendor and job it created and deactivate its
 * materials. Nothing is deleted; details it filled in on records that already existed stay.
 */
export async function undoImport(tenantId: number, userId: number, importId: number) {
  return db.transaction(async (tx) => {
    const imp = await lockImport(tx, tenantId, importId);
    if (imp.undoneAt) throw new UserError("This import was already undone.");
    const now = new Date();
    const archivedJobs = await tx
      .update(jobs)
      .set({ archivedAt: now, updatedAt: now })
      .where(and(eq(jobs.tenantId, tenantId), eq(jobs.importId, importId), isNull(jobs.archivedAt)))
      .returning({ id: jobs.id });
    const archivedContacts = await tx
      .update(customerContacts)
      .set({ archivedAt: now })
      .where(and(eq(customerContacts.tenantId, tenantId), eq(customerContacts.importId, importId), isNull(customerContacts.archivedAt)))
      .returning({ id: customerContacts.id });
    const archivedCustomers = await tx
      .update(customers)
      .set({ archivedAt: now, updatedAt: now })
      .where(and(eq(customers.tenantId, tenantId), eq(customers.importId, importId), isNull(customers.archivedAt)))
      .returning({ id: customers.id });
    const offMaterials = await tx
      .update(materials)
      .set({ active: false })
      .where(and(eq(materials.tenantId, tenantId), eq(materials.importId, importId), eq(materials.active, true)))
      .returning({ id: materials.id });
    const archivedVendors = await tx
      .update(vendors)
      .set({ archivedAt: now })
      .where(and(eq(vendors.tenantId, tenantId), eq(vendors.importId, importId), isNull(vendors.archivedAt)))
      .returning({ id: vendors.id });
    await tx
      .update(imports)
      .set({ undoneAt: now, undoneBy: userId })
      .where(and(eq(imports.tenantId, tenantId), eq(imports.id, importId)));
    const counts = {
      jobs: archivedJobs.length,
      contacts: archivedContacts.length,
      customers: archivedCustomers.length,
      materials: offMaterials.length,
      vendors: archivedVendors.length,
    };
    const parts = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${n === 1 ? SINGULAR[k as keyof typeof SINGULAR] : k}`);
    await logActivity(
      {
        tenantId,
        action: "import.undone",
        entityType: "setting",
        entityId: imp.id,
        actorId: userId,
        summary: `Undid the ${KINDS[imp.kind].noun} import from ${imp.filename}${parts.length ? ` — archived ${parts.join(", ")}` : ""}`,
        data: { importId: imp.id, kind: imp.kind, filename: imp.filename, ...counts },
      },
      tx,
    );
    return counts;
  });
}

export async function listImports(tenantId: number, limit = 25) {
  return db.select().from(imports).where(eq(imports.tenantId, tenantId)).orderBy(desc(imports.createdAt), desc(imports.id)).limit(limit);
}

/** Categories used to match "Category" cells on past jobs (also sent to the browser for the preview). */
export async function importCategories(tenantId: number) {
  return db
    .select({ id: productCategories.id, name: productCategories.name, slug: productCategories.slug, group: productCategories.group })
    .from(productCategories)
    .where(and(eq(productCategories.tenantId, tenantId), eq(productCategories.active, true)))
    .orderBy(asc(productCategories.sortOrder), asc(productCategories.id));
}

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------
type CustomerRow = typeof customers.$inferSelect;
type ContactRow = typeof customerContacts.$inferSelect;

async function findCustomers(tx: Tx, tenantId: number, names: string[], emails: string[] = []) {
  const keys = uniq(names.map(matchKey));
  const conds: SQL[] = [];
  if (keys.length) conds.push(inArray(keySql(customers.name), keys));
  if (emails.length) conds.push(inArray(sql`lower(${customers.email})`, emails));
  const byKey = new Map<string, CustomerRow>();
  const byEmail = new Map<string, CustomerRow>();
  if (!conds.length) return { byKey, byEmail };
  const found = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), isNull(customers.archivedAt), or(...conds)))
    .orderBy(asc(customers.id));
  for (const c of found) {
    const k = matchKey(c.name);
    if (!byKey.has(k)) byKey.set(k, c);
    if (c.email && !byEmail.has(c.email.toLowerCase())) byEmail.set(c.email.toLowerCase(), c);
  }
  return { byKey, byEmail };
}

async function contactsOf(tx: Tx, tenantId: number, customerIds: number[]) {
  const map = new Map<number, ContactRow[]>();
  if (!customerIds.length) return map;
  const rows = await tx
    .select()
    .from(customerContacts)
    .where(and(eq(customerContacts.tenantId, tenantId), inArray(customerContacts.customerId, customerIds), isNull(customerContacts.archivedAt)))
    .orderBy(asc(customerContacts.id));
  for (const r of rows) map.set(r.customerId, [...(map.get(r.customerId) ?? []), r]);
  return map;
}

type ContactIn = { name: string; title: string | null; email: string | null; phone: string | null; notes?: string | null; isPrimary?: boolean | null };

/** Add a contact to a customer, or fill in blanks on the one with the same name. Returns true if anything changed. */
async function upsertContact(
  tx: Tx,
  ctx: Ctx,
  customerId: number,
  list: ContactRow[],
  c: ContactIn,
  t: ImportSummary,
): Promise<"created" | "updated" | "unchanged"> {
  const same = list.find((x) => matchKey(x.name) === matchKey(c.name));
  if (same) {
    const patch = blanks(same, { title: c.title, email: c.email, phone: c.phone, notes: c.notes ?? null });
    if (!Object.keys(patch).length) return "unchanged";
    await tx
      .update(customerContacts)
      .set(patch)
      .where(and(eq(customerContacts.tenantId, ctx.tenantId), eq(customerContacts.id, same.id)));
    Object.assign(same, patch);
    return "updated";
  }
  const hasPrimary = list.some((x) => x.isPrimary);
  const [row] = await tx
    .insert(customerContacts)
    .values({
      tenantId: ctx.tenantId,
      customerId,
      name: c.name,
      title: c.title,
      email: c.email,
      phone: c.phone,
      notes: c.notes ?? null,
      isPrimary: !hasPrimary && c.isPrimary !== false,
      importId: ctx.importId,
    })
    .returning();
  list.push(row!);
  bump(t, "contactsCreated");
  return "created";
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
async function importCustomers(tx: Tx, ctx: Ctx, rows: ChunkRow[], t: ImportSummary) {
  const items = rows.map((r) => ({ row: r.row, n: normalizeCustomer(r.values) }));
  const good = items.filter((i) => {
    if (i.n.values) return true;
    t.errors.push({ row: i.row, message: i.n.errors.join("; ") });
    return false;
  });
  const { byKey, byEmail } = await findCustomers(
    tx,
    ctx.tenantId,
    good.map((i) => i.n.values!.name),
    uniq(good.map((i) => i.n.values!.email)),
  );
  const contacts = await contactsOf(tx, ctx.tenantId, uniq([...byKey.values(), ...byEmail.values()].map((c) => c.id)));

  for (const { n } of good) {
    const v = n.values!;
    const key = matchKey(v.name);
    const existing = byKey.get(key) ?? (v.email ? byEmail.get(v.email) : undefined);
    let cust: CustomerRow;
    let changed = false;
    if (existing) {
      cust = existing;
      const patch: Partial<CustomerRow> = blanks(existing, {
        phone: v.phone,
        email: v.email,
        website: v.website,
        address: v.address,
        city: v.city,
        state: v.state,
        zip: v.zip,
        billingAddress: v.billingAddress,
        notes: v.notes,
        customerSince: v.customerSince,
        externalId: v.externalId,
      });
      if (v.taxExempt === true && !existing.taxExempt) {
        patch.taxExempt = true;
        if (!existing.taxExemptId && v.taxExemptId) patch.taxExemptId = v.taxExemptId;
      }
      if (v.paymentTerms && v.paymentTerms !== existing.paymentTerms && existing.paymentTerms === "due_on_receipt") patch.paymentTerms = v.paymentTerms;
      if (Object.keys(patch).length) {
        await tx
          .update(customers)
          .set({ ...patch, updatedAt: new Date() })
          .where(and(eq(customers.tenantId, ctx.tenantId), eq(customers.id, existing.id)));
        Object.assign(existing, patch);
        changed = true;
      }
    } else {
      const [row] = await tx
        .insert(customers)
        .values({
          tenantId: ctx.tenantId,
          name: v.name,
          isCompany: v.isCompany,
          phone: v.phone,
          email: v.email,
          website: v.website,
          address: v.address,
          city: v.city,
          state: v.state,
          zip: v.zip,
          billingAddress: v.billingAddress,
          taxExempt: v.taxExempt === true,
          taxExemptId: v.taxExemptId,
          paymentTerms: v.paymentTerms ?? "due_on_receipt",
          notes: v.notes,
          customerSince: v.customerSince,
          externalId: v.externalId,
          importId: ctx.importId,
        })
        .returning();
      cust = row!;
      byKey.set(key, cust);
      if (cust.email) byEmail.set(cust.email.toLowerCase(), cust);
      contacts.set(cust.id, []);
      t.created++;
    }
    if (v.contact) {
      const list = contacts.get(cust.id) ?? [];
      contacts.set(cust.id, list);
      const r = await upsertContact(tx, ctx, cust.id, list, v.contact, t);
      if (r !== "unchanged") changed = true;
    }
    if (existing) {
      if (changed) t.updated++;
      else {
        t.skipped++;
        bump(t, "unchanged");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------
async function importContacts(tx: Tx, ctx: Ctx, rows: ChunkRow[], t: ImportSummary) {
  const items = rows.map((r) => ({ row: r.row, n: normalizeContact(r.values) }));
  const good = items.filter((i) => {
    if (i.n.values) return true;
    t.errors.push({ row: i.row, message: i.n.errors.join("; ") });
    return false;
  });
  const { byKey } = await findCustomers(
    tx,
    ctx.tenantId,
    good.map((i) => i.n.values!.customerName),
  );
  const contacts = await contactsOf(tx, ctx.tenantId, uniq([...byKey.values()].map((c) => c.id)));
  for (const { row, n } of good) {
    const v = n.values!;
    const cust = byKey.get(matchKey(v.customerName));
    if (!cust) {
      t.errors.push({ row, message: `No customer named “${v.customerName}” — import customers first, or check the spelling` });
      continue;
    }
    const list = contacts.get(cust.id) ?? [];
    contacts.set(cust.id, list);
    const r = await upsertContact(tx, ctx, cust.id, list, v, t);
    if (r === "created") t.created++;
    else if (r === "updated") t.updated++;
    else {
      t.skipped++;
      bump(t, "unchanged");
    }
  }
  // contactsCreated duplicates `created` for this kind.
  if (t.extra) delete t.extra.contactsCreated;
}

// ---------------------------------------------------------------------------
// Past jobs
// ---------------------------------------------------------------------------
/** Noon in the shop's time zone, so the job lands on the right day everywhere. */
const atNoon = (ymd: string) => new Date(`${ymd}T18:00:00Z`);

async function importJobs(tx: Tx, ctx: Ctx, rows: ChunkRow[], t: ImportSummary) {
  const categories = await importCategories(ctx.tenantId);
  const items = rows.map((r) => ({ row: r.row, n: normalizeJob(r.values, { categories }) }));
  const good = items.filter((i) => {
    if (i.n.values) return true;
    t.errors.push({ row: i.row, message: i.n.errors.join("; ") });
    return false;
  });
  if (!good.length) return;

  // Jobs already in the system with the same old number (from an earlier import, or this one).
  const legacy = uniq(good.map((i) => i.n.values!.legacyNumber));
  const existingJobs = new Map<string, { id: number; importId: number | null }>();
  if (legacy.length) {
    const found = await tx
      .select({ id: jobs.id, legacyNumber: jobs.legacyNumber, importId: jobs.importId })
      .from(jobs)
      .where(and(eq(jobs.tenantId, ctx.tenantId), isNull(jobs.archivedAt), inArray(jobs.legacyNumber, legacy)))
      .orderBy(asc(jobs.id));
    for (const j of found) if (!existingJobs.has(j.legacyNumber!)) existingJobs.set(j.legacyNumber!, { id: j.id, importId: j.importId });
  }

  type Pending = { lines: { row: number; v: JobValues }[] };
  const pending: Pending[] = [];
  const pendingByLegacy = new Map<string, Pending>();
  const extraLines: { jobId: number; row: number; v: JobValues }[] = [];
  for (const { row, n } of good) {
    const v = n.values!;
    const prior = v.legacyNumber ? existingJobs.get(v.legacyNumber) : undefined;
    if (prior) {
      if (prior.importId === ctx.importId) extraLines.push({ jobId: prior.id, row, v });
      else {
        t.skipped++;
        bump(t, "duplicates");
      }
      continue;
    }
    const open = v.legacyNumber ? pendingByLegacy.get(v.legacyNumber) : undefined;
    if (open) {
      open.lines.push({ row, v });
      bump(t, "linesAdded");
      continue;
    }
    const p: Pending = { lines: [{ row, v }] };
    pending.push(p);
    if (v.legacyNumber) pendingByLegacy.set(v.legacyNumber, p);
  }

  // Customers: match by name, create the ones that don't exist yet.
  const { byKey } = await findCustomers(
    tx,
    ctx.tenantId,
    pending.map((p) => p.lines[0]!.v.customerName),
  );
  const missing = new Map<string, string>();
  for (const p of pending) {
    const name = p.lines[0]!.v.customerName;
    const k = matchKey(name);
    if (!byKey.has(k) && !missing.has(k)) missing.set(k, name);
  }
  if (missing.size) {
    const created = await tx
      .insert(customers)
      .values(
        [...missing.values()].map((name) => ({
          tenantId: ctx.tenantId,
          name,
          isCompany: true,
          importId: ctx.importId,
          notes: `Added by the past-jobs import (${ctx.filename})`,
        })),
      )
      .returning();
    for (const c of created) byKey.set(matchKey(c.name), c);
    bump(t, "customersCreated", created.length);
  }

  if (pending.length) {
    // Reserve a block of job numbers for this chunk in one step.
    const [r] = await tx
      .update(tenants)
      .set({ nextJobNumber: sql`${tenants.nextJobNumber} + ${pending.length}` })
      .where(eq(tenants.id, ctx.tenantId))
      .returning({ start: sql<number>`${tenants.nextJobNumber} - ${pending.length}` });
    const start = Number(r!.start);
    const todayYmd = today();
    const values = pending.map((p, i) => {
      const first = p.lines[0]!.v;
      const subtotal = p.lines.reduce((a, l) => a + l.v.priceCents, 0);
      const tax = p.lines.reduce((a, l) => a + l.v.taxCents, 0);
      const when = first.date ? atNoon(first.date) : new Date();
      const notes = [first.notes, first.originalStatus && `Status in the old system: ${first.originalStatus}`].filter(Boolean).join("\n") || null;
      return {
        tenantId: ctx.tenantId,
        number: start + i,
        customerId: byKey.get(matchKey(first.customerName))!.id,
        title: first.title,
        categoryId: first.categoryId,
        description: p.lines.length === 1 && first.description !== first.title ? first.description : null,
        status: first.status,
        needsDesign: false,
        needsProof: false,
        needsInstall: false,
        dueDate: first.date ?? todayYmd,
        poNumber: first.poNumber,
        subtotalCents: subtotal,
        taxCents: tax,
        totalCents: subtotal + tax,
        taxRate: subtotal > 0 && tax > 0 ? Math.min(0.99, Math.round((tax / subtotal) * 10000) / 10000) : 0,
        internalNotes: notes,
        legacyNumber: first.legacyNumber,
        importId: ctx.importId,
        completedAt: first.status === "completed" ? when : null,
        createdBy: ctx.userId,
        createdAt: when,
        updatedAt: when,
      };
    });
    const inserted = await tx.insert(jobs).values(values).returning({ id: jobs.id, number: jobs.number, status: jobs.status, createdAt: jobs.createdAt });
    const idByNumber = new Map(inserted.map((j) => [j.number, j]));
    const lineValues = pending.flatMap((p, i) => {
      const job = idByNumber.get(start + i)!;
      return p.lines.map((l) => lineOf(ctx, job.id, l.row, l.v));
    });
    await tx.insert(jobItems).values(lineValues);
    await tx.insert(jobStatusHistory).values(
      inserted.map((j) => ({
        tenantId: ctx.tenantId,
        jobId: j.id,
        fromStatus: null,
        toStatus: j.status,
        changedBy: ctx.userId,
        note: `Imported from ${ctx.filename}`,
        changedAt: j.createdAt,
      })),
    );
    t.created += pending.length;
  }

  // More lines for jobs this import created in an earlier chunk.
  if (extraLines.length) {
    await tx.insert(jobItems).values(extraLines.map((l) => lineOf(ctx, l.jobId, l.row, l.v)));
    const add = new Map<number, { sub: number; tax: number }>();
    for (const l of extraLines) {
      const a = add.get(l.jobId) ?? { sub: 0, tax: 0 };
      a.sub += l.v.priceCents;
      a.tax += l.v.taxCents;
      add.set(l.jobId, a);
    }
    for (const [jobId, a] of add) {
      await tx
        .update(jobs)
        .set({
          subtotalCents: sql`${jobs.subtotalCents} + ${a.sub}`,
          taxCents: sql`${jobs.taxCents} + ${a.tax}`,
          totalCents: sql`${jobs.totalCents} + ${a.sub + a.tax}`,
          description: null,
        })
        .where(and(eq(jobs.tenantId, ctx.tenantId), eq(jobs.id, jobId)));
    }
    bump(t, "linesAdded", extraLines.length);
  }
}

function lineOf(ctx: Ctx, jobId: number, row: number, v: JobValues) {
  return {
    tenantId: ctx.tenantId,
    jobId,
    categoryId: v.categoryId,
    description: v.description,
    quantity: v.quantity,
    widthIn: v.widthIn,
    heightIn: v.heightIn,
    material: v.material,
    colors: v.colors,
    recommendedCents: v.priceCents,
    priceCents: v.priceCents,
    taxable: v.taxCents > 0,
    sortOrder: row,
  };
}

// ---------------------------------------------------------------------------
// Vendors (also used by the materials import)
// ---------------------------------------------------------------------------
type VendorRow = typeof vendors.$inferSelect;

async function findVendors(tx: Tx, tenantId: number, names: string[]) {
  const keys = uniq(names.map(matchKey));
  const byKey = new Map<string, VendorRow>();
  if (!keys.length) return byKey;
  const found = await tx
    .select()
    .from(vendors)
    .where(and(eq(vendors.tenantId, tenantId), isNull(vendors.archivedAt), inArray(keySql(vendors.name), keys)))
    .orderBy(asc(vendors.id));
  for (const v of found) if (!byKey.has(matchKey(v.name))) byKey.set(matchKey(v.name), v);
  return byKey;
}

async function importVendors(tx: Tx, ctx: Ctx, rows: ChunkRow[], t: ImportSummary) {
  const items = rows.map((r) => ({ row: r.row, n: normalizeVendor(r.values) }));
  const good = items.filter((i) => {
    if (i.n.values) return true;
    t.errors.push({ row: i.row, message: i.n.errors.join("; ") });
    return false;
  });
  const byKey = await findVendors(
    tx,
    ctx.tenantId,
    good.map((i) => i.n.values!.name),
  );
  for (const { n } of good) {
    const v = n.values!;
    const key = matchKey(v.name);
    const existing = byKey.get(key);
    if (existing) {
      const patch = blanks(existing, {
        contactName: v.contactName,
        phone: v.phone,
        email: v.email,
        website: v.website,
        accountNumber: v.accountNumber,
        notes: v.notes,
      });
      if (Object.keys(patch).length) {
        await tx
          .update(vendors)
          .set(patch)
          .where(and(eq(vendors.tenantId, ctx.tenantId), eq(vendors.id, existing.id)));
        Object.assign(existing, patch);
        t.updated++;
      } else {
        t.skipped++;
        bump(t, "unchanged");
      }
      continue;
    }
    const [row] = await tx
      .insert(vendors)
      .values({ tenantId: ctx.tenantId, ...v, importId: ctx.importId })
      .returning();
    byKey.set(key, row!);
    t.created++;
  }
}

// ---------------------------------------------------------------------------
// Paper & materials
// ---------------------------------------------------------------------------
async function importMaterials(tx: Tx, ctx: Ctx, rows: ChunkRow[], t: ImportSummary) {
  const items = rows.map((r) => ({ row: r.row, n: normalizeMaterial(r.values) }));
  const good = items.filter((i) => {
    if (i.n.values) return true;
    t.errors.push({ row: i.row, message: i.n.errors.join("; ") });
    return false;
  });
  if (!good.length) return;

  // Vendors by name; create the missing ones.
  const vendorByKey = await findVendors(tx, ctx.tenantId, uniq(good.map((i) => i.n.values!.vendorName)));
  const missing = new Map<string, string>();
  for (const { n } of good) {
    const name = n.values!.vendorName;
    if (name && !vendorByKey.has(matchKey(name)) && !missing.has(matchKey(name))) missing.set(matchKey(name), name);
  }
  if (missing.size) {
    const created = await tx
      .insert(vendors)
      .values([...missing.values()].map((name) => ({ tenantId: ctx.tenantId, name, importId: ctx.importId })))
      .returning();
    for (const v of created) vendorByKey.set(matchKey(v.name), v);
    bump(t, "vendorsCreated", created.length);
  }

  const keys = uniq(good.map((i) => matchKey(i.n.values!.name)));
  const found = await tx
    .select()
    .from(materials)
    .where(and(eq(materials.tenantId, ctx.tenantId), eq(materials.active, true), inArray(keySql(materials.name), keys)))
    .orderBy(asc(materials.id));
  const byKey = new Map<string, typeof materials.$inferSelect>();
  for (const m of found) if (!byKey.has(matchKey(m.name))) byKey.set(matchKey(m.name), m);

  for (const { n } of good) {
    const v = n.values!;
    const key = matchKey(v.name);
    const vendorId = v.vendorName ? (vendorByKey.get(matchKey(v.vendorName))?.id ?? null) : null;
    const existing = byKey.get(key);
    if (existing) {
      const patch: Partial<typeof materials.$inferSelect> = blanks(existing, {
        vendorId,
        sku: v.sku,
        weight: v.weight,
        sheetWidthIn: v.sheetWidthIn,
        sheetHeightIn: v.sheetHeightIn,
        costPerMCents: v.costPerMCents,
      });
      if (!existing.costCents && v.costCents) patch.costCents = v.costCents;
      if (Object.keys(patch).length) {
        await tx
          .update(materials)
          .set(patch)
          .where(and(eq(materials.tenantId, ctx.tenantId), eq(materials.id, existing.id)));
        Object.assign(existing, patch);
        t.updated++;
      } else {
        t.skipped++;
        bump(t, "unchanged");
      }
      continue;
    }
    const [row] = await tx
      .insert(materials)
      .values({
        tenantId: ctx.tenantId,
        name: v.name,
        kind: v.kind,
        unit: v.unit,
        costCents: v.costCents,
        vendorId,
        sku: v.sku,
        sheetWidthIn: v.sheetWidthIn,
        sheetHeightIn: v.sheetHeightIn,
        weight: v.weight,
        costPerMCents: v.costPerMCents,
        importId: ctx.importId,
      })
      .returning();
    byKey.set(key, row!);
    t.created++;
  }
}
