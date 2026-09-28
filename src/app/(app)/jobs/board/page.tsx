import { Tv } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { boardJobs } from "@/lib/jobs/queries";
import { getActiveUsers, getLocations } from "@/lib/lookups";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/button";
import { ViewToggle } from "@/components/jobs/view-toggle";
import { ProductionBoard } from "@/components/jobs/production-board";

export const metadata = { title: "Production Board" };

export default async function BoardPage() {
  const user = await requirePagePermission("jobs.view");
  const [jobs, people, locations] = await Promise.all([boardJobs(user), getActiveUsers(user.tenantId), getLocations(user.tenantId)]);
  return (
    <>
      <PageHeader
        title="Production Board"
        subtitle={`${jobs.filter((j) => j.status !== "completed").length} jobs in progress`}
        actions={
          <>
            <ViewToggle active="board" />
            <LinkButton href="/tv" target="_blank">
              <Tv className="size-4" /> TV mode
            </LinkButton>
            <LinkButton href="/tv?view=machines" target="_blank">
              <Tv className="size-4" /> Machines TV
            </LinkButton>
          </>
        }
      />
      <ProductionBoard jobs={jobs} people={people.map((p) => ({ id: p.id, name: p.name }))} locations={locations.map((l) => ({ code: l.code, name: l.name }))} canMove={can(user.role, "jobs.status")} />
    </>
  );
}
