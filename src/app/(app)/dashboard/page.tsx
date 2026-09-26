import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  FileText,
  Flame,
  Hammer,
  PackageCheck,
  Receipt,
  Stamp,
  Truck,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { attentionJobs, importantMessages, jobsCompletedByMonth, moneyCards, myQueue, quoteWinRate, revenueByMonth, salesByCategory, todayCounts } from "@/lib/dashboard";
import { getMyTasks } from "@/lib/tasks/queries";
import { getActiveUsers } from "@/lib/lookups";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { JobStatusBadge, PriorityBadge } from "@/components/status";
import { DueText } from "@/components/jobs/job-meta";
import { TaskList } from "@/components/tasks/task-list";
import { BarList, ColumnChart } from "@/components/charts";
import { fmtTime, jobNo, money, moneyShort, pct, plural, timeAgo, today } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

function greeting() {
  const h = Number(new Date().toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage() {
  const user = await requireUser();
  const r = user.role;
  const company = can(r, "dashboard.company");
  const money$ = can(r, "financials.view") && company;
  const showMoneyCards = money$ && (can(r, "money.view") || r === "manager");

  const [counts, tasks, people, msgs, queue, late, cards, revenue, byCat, win, completed] = await Promise.all([
    todayCounts(user.tenantId),
    getMyTasks(user.tenantId, user.id),
    getActiveUsers(user.tenantId),
    can(r, "messages.use") ? importantMessages(user.tenantId, user.id) : Promise.resolve([]),
    company ? Promise.resolve([]) : myQueue(user.tenantId, user.id, r),
    company ? attentionJobs(user.tenantId) : Promise.resolve([]),
    showMoneyCards ? moneyCards(user.tenantId) : Promise.resolve(null),
    money$ ? revenueByMonth(user.tenantId, 12) : Promise.resolve([]),
    money$ ? salesByCategory(user.tenantId, 90) : Promise.resolve([]),
    company && can(r, "quotes.view") ? quoteWinRate(user.tenantId, 90) : Promise.resolve(null),
    company ? jobsCompletedByMonth(user.tenantId, 6) : Promise.resolve([]),
  ]);

  // ---------------- Needs attention (actionable) ----------------
  const attention: { n: number; text: string; href: string; tone: "red" | "amber" }[] = [];
  // Each role only sees alerts it can act on.
  const office = company || r === "sales";
  if (office) attention.push({ n: counts.overdue, text: `${plural(counts.overdue, "job is", "jobs are")} overdue`, href: "/jobs?view=overdue", tone: "red" });
  if (office || r === "production" || r === "designer")
    attention.push({ n: counts.missingArtwork, text: `${plural(counts.missingArtwork, "production job is", "production jobs are")} missing artwork`, href: "/jobs?view=noart", tone: "red" });
  if (office || r === "designer")
    attention.push({ n: counts.proofsAwaiting, text: `${plural(counts.proofsAwaiting, "customer proof needs", "customer proofs need")} approval`, href: "/jobs?view=proofs", tone: "amber" });
  if (can(r, "quotes.view")) {
    attention.push({ n: counts.quotesStale, text: `${plural(counts.quotesStale, "quote has", "quotes have")} had no response for 7+ days`, href: "/quotes?view=followup", tone: "amber" });
    attention.push({ n: counts.quotesAccepted, text: `${plural(counts.quotesAccepted, "accepted quote is", "accepted quotes are")} waiting to become a job`, href: "/quotes?view=accepted", tone: "amber" });
  }
  if (can(r, "money.view")) attention.push({ n: counts.overdueInvoices, text: `${plural(counts.overdueInvoices, "invoice is", "invoices are")} overdue`, href: "/money?tab=receivables", tone: "red" });
  const needs = attention.filter((a) => a.n > 0);

  // ---------------- TODAY tiles ----------------
  const tiles = [
    { show: can(r, "jobs.view"), label: "Due today", value: counts.dueToday, icon: CalendarClock, href: "/jobs?view=today" },
    { show: can(r, "jobs.view"), label: "Overdue", value: counts.overdue, icon: AlertTriangle, href: "/jobs?view=overdue", alert: counts.overdue > 0 },
    { show: can(r, "quotes.view"), label: "Quotes awaiting response", value: counts.quotesAwaiting, icon: FileText, href: "/quotes?view=open" },
    { show: can(r, "jobs.view"), label: "Proofs awaiting approval", value: counts.proofsAwaiting, icon: Stamp, href: "/jobs?view=proofs" },
    { show: can(r, "jobs.view"), label: "Ready for pickup", value: counts.ready, icon: PackageCheck, href: "/jobs?view=ready" },
    { show: can(r, "jobs.view"), label: "Installs today", value: counts.installsToday, icon: Truck, href: "/calendar?view=day" },
    { show: can(r, "jobs.view") && !can(r, "money.view"), label: "In production", value: counts.inProduction, icon: Hammer, href: "/jobs/board?dept=production" },
    { show: can(r, "money.view"), label: "Unpaid invoices", value: counts.unpaidInvoices, icon: Receipt, href: "/money?tab=invoices" },
  ].filter((t) => t.show);

  const dateLabel = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          {greeting()}, {user.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-[15px] text-slate-500">{dateLabel}</p>
      </div>

      {/* ---------------- My work ---------------- */}
      {!company && queue.length >= 0 && can(r, "jobs.view") && (
        <Card>
          <CardHeader
            title={r === "designer" ? "My design queue" : r === "production" ? "Production queue — what's next" : r === "installer" ? "My installations" : "My jobs"}
            action={<Link href="/jobs?view=mine" className="text-sm font-medium text-brand-600 hover:underline">All my jobs</Link>}
          />
          <CardBody className="p-2">
            {queue.length === 0 ? (
              <p className="px-3 py-6 text-[15px] text-slate-500">You&apos;re all caught up — nothing is waiting on you.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {queue.map((j) => (
                  <li key={j.id}>
                    <Link href={`/jobs/${j.number}`} className="flex flex-wrap items-center gap-3 rounded-lg px-3 py-3 hover:bg-slate-50">
                      <span className="w-20 text-sm font-semibold text-brand-700">{jobNo(j.number)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium text-slate-900">{j.title}</p>
                        <p className="truncate text-sm text-slate-500">
                          {j.customer}
                          {r === "installer" && j.fulfillmentAt && ` · ${new Date(j.fulfillmentAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" })} ${fmtTime(j.fulfillmentAt)}`}
                          {r === "installer" && j.siteAddress && ` · ${j.siteAddress}`}
                        </p>
                      </div>
                      <span className="flex items-center gap-2">
                        {j.priority !== "normal" && <PriorityBadge priority={j.priority} />}
                        <JobStatusBadge status={j.status} />
                        <DueText dueDate={j.dueDate} overdue={j.overdue} className="text-sm" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {/* ---------------- Needs attention + Today ---------------- */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card className={cn(needs.length > 0 && "border-amber-200", !company && needs.length === 0 && "hidden xl:block")}>
          <CardHeader title="Needs attention" />
          <CardBody className="p-2">
            {needs.length === 0 ? (
              <div className="flex items-center gap-3 px-3 py-6 text-[15px] text-emerald-700">
                <CheckCircle2 className="size-6" /> Nothing needs attention right now.
              </div>
            ) : (
              <ul>
                {needs.map((a) => (
                  <li key={a.href}>
                    <Link href={a.href} className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-slate-50">
                      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold", a.tone === "red" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800")}>{a.n}</span>
                      <span className="flex-1 text-[15px] text-slate-800">{a.text.replace(/^\d+ /, "")}</span>
                      <ChevronRight className="size-4 text-slate-300" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Today</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map((t) => (
              <Link key={t.label} href={t.href} className={cn("group rounded-xl border bg-white p-4 shadow-sm hover:border-brand-300 hover:shadow", t.alert ? "border-red-200" : "border-slate-200")}>
                <t.icon className={cn("size-5", t.alert ? "text-red-500" : "text-slate-400 group-hover:text-brand-500")} />
                <p className={cn("tabular mt-3 text-3xl font-semibold", t.alert ? "text-red-600" : "text-slate-900")}>{t.value}</p>
                <p className="mt-0.5 text-sm text-slate-600">{t.label}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ---------------- Money ---------------- */}
      {cards && (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Money</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MoneyTile label="Sales today" value={money(cards.salesToday, { cents: false })} />
            <MoneyTile label="Sales this week" value={moneyShort(cards.salesWeek)} />
            <MoneyTile label="Sales this month" value={moneyShort(cards.salesMonth)} strong />
            <MoneyTile label="Cash collected this month" value={moneyShort(cards.cashMonth)} />
            <MoneyTile label="Outstanding invoices" value={moneyShort(cards.outstanding)} sub={`${cards.outstandingCount} unpaid`} href="/money?tab=receivables" />
            <MoneyTile label="Open quotes" value={moneyShort(cards.openQuotesValue)} sub={`${cards.openQuotes} quotes · estimated value`} href="/quotes" />
            {/* Expenses are costs: not for managers (margins.view). */}
            {can(r, "margins.view") && <MoneyTile label="Expenses this month" value={moneyShort(cards.expensesMonth)} href="/money?tab=expenses" />}
            {can(r, "margins.view") && <MoneyTile label="Est. gross profit this month" value={moneyShort(cards.grossProfitMonth)} sub={cards.salesMonth ? `${pct(cards.grossProfitMonth / cards.salesMonth)} of sales` : undefined} />}
          </div>
        </div>
      )}

      {/* ---------------- Charts ---------------- */}
      {company && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {money$ && (
            <Card className="lg:col-span-2">
              <CardHeader title="Revenue by month" description="Invoiced sales, last 12 months (before tax)" />
              <CardBody>
                <ColumnChart label="Revenue by month" data={revenue.map((m) => ({ label: m.label, value: m.value, sub: `${m.count} invoices` }))} format={(v) => moneyShort(v)} />
              </CardBody>
            </Card>
          )}
          {money$ && (
            <Card>
              <CardHeader title="Sales by product" description="Last 90 days" />
              <CardBody>
                {byCat.length ? <BarList data={byCat} format={(v) => moneyShort(v)} /> : <p className="text-sm text-slate-500">No sales in the last 90 days.</p>}
              </CardBody>
            </Card>
          )}
          {win && (
            <Card>
              <CardHeader title="Quote win rate" description="Quotes created in the last 90 days that got an answer" />
              <CardBody>
                {win.rate == null ? (
                  <p className="text-sm text-slate-500">No quotes have been won or lost yet.</p>
                ) : (
                  <>
                    <p className="tabular text-5xl font-semibold text-slate-900">{pct(win.rate)}</p>
                    <div className="mt-4 flex h-2 gap-[2px] overflow-hidden rounded-full">
                      <div className="rounded-l-full bg-brand-500" style={{ width: `${win.rate * 100}%` }} />
                      <div className="flex-1 rounded-r-full bg-slate-200" />
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      {win.won} won · {win.lost} lost or expired
                    </p>
                  </>
                )}
              </CardBody>
            </Card>
          )}
          <Card className={cn(!money$ && "lg:col-span-2")}>
            <CardHeader title="Jobs completed" description="Last 6 months" />
            <CardBody>
              <ColumnChart label="Jobs completed by month" data={completed} format={(v) => String(Math.round(v))} height={140} />
            </CardBody>
          </Card>
          {late.length > 0 && (
            <Card>
              <CardHeader title="Due today & late" action={<Link href="/jobs?view=today" className="text-sm font-medium text-brand-600 hover:underline">All</Link>} />
              <CardBody className="p-2">
                <ul>
                  {late.map((j) => (
                    <li key={j.number}>
                      <Link href={`/jobs/${j.number}`} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-medium text-slate-800">{j.title}</p>
                          <p className="truncate text-xs text-slate-500">
                            {jobNo(j.number)} · {j.customer}
                          </p>
                        </div>
                        <DueText dueDate={j.dueDate} overdue={!!j.dueDate && j.dueDate < today()} className="text-xs" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="My tasks" action={<Link href="/tasks" className="text-sm font-medium text-brand-600 hover:underline">All tasks</Link>} />
          <CardBody>
            <TaskList tasks={tasks} users={people} compact hideAssignee emptyText="No open tasks. Add one below." />
          </CardBody>
        </Card>
        {can(r, "messages.use") && (
          <Card>
            <CardHeader title="Important messages" description="Flagged messages and @mentions of you, last 3 days" action={<Link href="/messages" className="text-sm font-medium text-brand-600 hover:underline">Messages</Link>} />
            <CardBody className="p-2">
              {msgs.length === 0 ? (
                <p className="px-3 py-6 text-[15px] text-slate-500">No important messages.</p>
              ) : (
                <ul>
                  {msgs.map((m) => (
                    <li key={m.id}>
                      <Link href={m.jobNumber ? `/jobs/${m.jobNumber}?tab=chat` : `/messages?channel=${m.channel ?? "general"}`} className="flex gap-3 rounded-lg px-3 py-2.5 hover:bg-slate-50">
                        <Avatar name={m.author} color={m.color} size="sm" className="mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-slate-500">
                            <span className="font-medium text-slate-700">{m.author}</span> · {m.jobNumber ? `${jobNo(m.jobNumber)} ${m.jobTitle}` : `#${(m.channel ?? "general").replace("_", " ")}`} · {timeAgo(m.at)}
                          </p>
                          <p className="line-clamp-2 text-[15px] text-slate-800">{m.body}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        )}
      </div>
      {counts.rush > 0 && can(r, "jobs.view") && (
        <Link href="/jobs?view=rush" className="flex items-center gap-2 text-sm font-medium text-orange-700 hover:underline">
          <Flame className="size-4" /> {plural(counts.rush, "rush job")} in progress
        </Link>
      )}
    </div>
  );
}

function MoneyTile({ label, value, sub, strong, href }: { label: string; value: string; sub?: string; strong?: boolean; href?: string }) {
  const inner = (
    <>
      <p className="text-sm text-slate-500">{label}</p>
      <p className={cn("tabular mt-1 font-semibold text-slate-900", strong ? "text-3xl" : "text-2xl")}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300">
      {inner}
    </Link>
  ) : (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">{inner}</div>
  );
}
