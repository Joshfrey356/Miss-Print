import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getActiveUsers, getCategories, getLocations } from "@/lib/lookups";
import { pickedCustomer } from "@/lib/quotes/builder-data";
import { PageHeader } from "@/components/ui/page-header";
import { NewJobForm } from "@/components/jobs/new-job-form";

export const metadata = { title: "New Job" };

export default async function NewJobPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const user = await requirePagePermission("jobs.create");
  const { customerId } = await searchParams;
  const [cats, people, locations, customer] = await Promise.all([getCategories(), getActiveUsers(), getLocations(), customerId ? pickedCustomer(Number(customerId)) : Promise.resolve(null)]);
  return (
    <>
      <PageHeader title="New job" back={{ href: "/jobs", label: "Jobs" }} subtitle="For work that's already priced and approved — like a walk-in or a repeat order." />
      <NewJobForm
        initialCustomer={customer}
        categories={cats.map((c) => ({ id: c.id, name: c.name, defaultNeedsProof: c.defaultNeedsProof, defaultNeedsInstall: c.defaultNeedsInstall, defaultLocationId: c.defaultLocationId }))}
        people={people.map((p) => ({ id: p.id, name: p.name, role: p.role }))}
        locations={locations.map((l) => ({ id: l.id, name: l.name }))}
        canSeeMoney={can(user.role, "financials.view")}
        currentUserId={user.id}
      />
    </>
  );
}
