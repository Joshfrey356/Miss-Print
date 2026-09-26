import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { CheckCircle2 } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { jobNo, parseJobNumber, today } from "@/lib/format";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getVendorSuggestions } from "@/lib/money/expenses";
import { ExpenseForm } from "../expense-form";

export const metadata: Metadata = { title: "New expense" };

export default async function NewExpensePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePagePermission("expenses.edit");
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));

  // Prefill the job from ?jobId=123 or ?job=MP-10428 (when coming from a job page).
  const jobIdParam = Number(one("jobId"));
  const jobNumParam = one("job") ? parseJobNumber(one("job")!) : null;
  const [job] =
    Number.isInteger(jobIdParam) && jobIdParam > 0
      ? await db.select({ number: jobs.number, title: jobs.title }).from(jobs).where(eq(jobs.id, jobIdParam))
      : jobNumParam
        ? await db.select({ number: jobs.number, title: jobs.title }).from(jobs).where(eq(jobs.number, jobNumParam))
        : [];
  const vendors = await getVendorSuggestions();
  const fromJob = !!job;
  const cancelHref = fromJob ? `/jobs/${job.number}?tab=money` : can(user.role, "money.view") ? "/money?tab=expenses" : "/dashboard";

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="New expense"
        subtitle={fromJob ? `For ${jobNo(job.number)} · ${job.title}` : "Snap the receipt, enter the amount, done."}
        back={fromJob ? { href: cancelHref, label: jobNo(job.number) } : can(user.role, "money.view") ? { href: "/money?tab=expenses", label: "Expenses" } : undefined}
      />
      {one("saved") === "1" && (
        <p className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="size-4" /> Expense saved. Add another below.
        </p>
      )}
      <Card>
        <CardBody className="py-5">
          <ExpenseForm
            mode="new"
            vendors={vendors}
            backToJob={fromJob}
            cancelHref={cancelHref}
            maxDate={today(1)}
            initial={{ vendor: "", amount: "", category: "", spentOn: today(), job: job ? jobNo(job.number) : "", paymentMethod: "Card", notes: "" }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
