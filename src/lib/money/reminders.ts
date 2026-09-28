import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { communications, customerContacts, customers, invoices, jobs } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { emailProvider } from "@/lib/email";
import { daysBetween, fmtDate, invoiceNo, jobNo, money, today } from "@/lib/format";
import { getSettings, type CompanyProfile } from "@/lib/settings";
import { UserError } from "@/lib/actions";
import { balanceOf } from "./service";
import { invoicePayUrl, MIN_CARD_CENTS } from "@/lib/payments/links";

type Actor = { id: number; name: string };

/** Payment reminder email text. Plain, friendly, no pressure. */
export function paymentReminderEmail(p: {
  company: CompanyProfile;
  customerName: string;
  invoiceNumber: number;
  balanceCents: number;
  dueDate: string;
  jobNumber?: number | null;
  jobTitle?: string | null;
  now?: string;
  /** "Pay online" link (Stripe), when the shop takes card payments online. */
  payUrl?: string | null;
}) {
  const now = p.now ?? today();
  const late = daysBetween(p.dueDate, now);
  const inv = invoiceNo(p.invoiceNumber);
  const forJob = p.jobNumber ? ` for ${jobNo(p.jobNumber)}${p.jobTitle ? ` (${p.jobTitle})` : ""}` : "";
  const due =
    late > 0
      ? `was due on ${fmtDate(p.dueDate, { year: true })} (${late} day${late === 1 ? "" : "s"} ago)`
      : late === 0
        ? "is due today"
        : `is due on ${fmtDate(p.dueDate, { year: true })}`;
  const c = p.company;
  const subject = `Payment reminder: ${inv} from ${c.name}`;
  const text = [
    `Hi ${p.customerName},`,
    "",
    `This is a friendly reminder that invoice ${inv}${forJob} has a balance of ${money(p.balanceCents)} and ${due}.`,
    "",
    ...(p.payUrl ? [`Pay online by card: ${p.payUrl}`, ""] : []),
    `${p.payUrl ? "You can also pay" : "You can pay"} by calling us at ${c.phone} or stopping by ${c.address}. If you've already sent payment, thank you — please disregard this note.`,
    "",
    `Questions? Just reply to this email or call ${c.phone}.`,
    "",
    "Thank you for your business!",
    "",
    c.name,
    c.tagline,
    [c.phone, c.email, c.website].filter(Boolean).join(" · "),
  ].join("\n");
  return { subject, text };
}

/** Best email for billing: customer email, then primary contact, then any contact. */
async function billingEmail(tenantId: number, customerId: number) {
  const [cust] = await db.select({ email: customers.email }).from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
  if (cust?.email) return cust.email;
  const [contact] = await db
    .select({ email: customerContacts.email })
    .from(customerContacts)
    .where(and(eq(customerContacts.tenantId, tenantId), eq(customerContacts.customerId, customerId), isNull(customerContacts.archivedAt), sql`${customerContacts.email} is not null`))
    .orderBy(desc(customerContacts.isPrimary), asc(customerContacts.id))
    .limit(1);
  return contact?.email ?? null;
}

/** Send a payment reminder for an open invoice, log it, and stamp lastReminderAt. */
export async function sendPaymentReminder(tenantId: number, invoiceId: number, actor: Actor) {
  const [row] = await db
    .select({ inv: invoices, customerName: customers.name, jobNumber: jobs.number, jobTitle: jobs.title })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(jobs, eq(jobs.id, invoices.jobId))
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)));
  if (!row) throw new UserError("Invoice not found.");
  const { inv } = row;
  const balance = balanceOf(inv);
  if (inv.status === "void") throw new UserError("This invoice is void.");
  if (balance <= 0) throw new UserError("This invoice is already paid.");
  const to = await billingEmail(tenantId, inv.customerId);
  if (!to) throw new UserError(`${row.customerName} has no email address on file. Add one to the customer first.`);

  const { company } = await getSettings(tenantId);
  let payUrl: string | null = null;
  try {
    payUrl = balance >= MIN_CARD_CENTS ? await invoicePayUrl(tenantId, inv.id) : null;
  } catch (e) {
    console.error("[payment reminder] pay link", e); // send the reminder without it
  }
  const { subject, text } = paymentReminderEmail({
    payUrl,
    company,
    customerName: row.customerName,
    invoiceNumber: inv.number,
    balanceCents: balance,
    dueDate: inv.dueDate,
    jobNumber: row.jobNumber,
    jobTitle: row.jobTitle,
  });
  const result = await emailProvider().send({ to, subject, text, fromName: company.name, replyTo: company.email || undefined });

  await db.transaction(async (tx) => {
    await tx.insert(communications).values({
      tenantId,
      customerId: inv.customerId,
      jobId: inv.jobId,
      invoiceId: inv.id,
      channel: "email",
      direction: "outbound",
      template: "payment_reminder",
      toAddress: to,
      subject,
      body: text,
      status: result.ok ? "sent" : "failed",
      providerId: result.providerId ?? null,
      sentBy: actor.id,
    });
    if (result.ok) {
      await tx.update(invoices).set({ lastReminderAt: new Date() }).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, inv.id)));
      await logActivity(
        {
          tenantId,
          action: "invoice.reminder_sent",
          entityType: "invoice",
          entityId: inv.id,
          jobId: inv.jobId,
          customerId: inv.customerId,
          actorId: actor.id,
          summary: `Sent payment reminder for ${invoiceNo(inv.number)} (${money(balance)} due) to ${to}`,
        },
        tx,
      );
    }
  });
  if (!result.ok) {
    console.error("[payment reminder]", result.error);
    throw new UserError("The email couldn't be sent. Please try again in a few minutes.");
  }
  return { to };
}
