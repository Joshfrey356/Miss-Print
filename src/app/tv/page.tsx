import { requirePagePermission } from "@/lib/auth";
import { boardJobs } from "@/lib/jobs/queries";
import { today } from "@/lib/format";
import { getLocations } from "@/lib/lookups";
import { getBrand } from "@/lib/brand";
import { TvBoard } from "./tv-board";

export const metadata = { title: "Production TV" };
export const dynamic = "force-dynamic";

/**
 * Production TV mode: big, glanceable, NO financial information.
 * Open on the shop monitor (signed in as any production account). Refreshes itself.
 */
export default async function TvPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const user = await requirePagePermission("jobs.view");
  const { location } = await searchParams;
  const [board, locations, brand] = await Promise.all([boardJobs({ ...user, role: "production" }), getLocations(user.tenantId), getBrand(user.tenantId)]);
  const all = board.filter((j) => j.status !== "completed" && (!location || j.locationCode === location));
  const t = today();
  const strip = (j: (typeof all)[number]) => ({
    id: j.id,
    number: j.number,
    title: j.title,
    customer: j.customer,
    status: j.status,
    priority: j.priority,
    dueDate: j.dueDate,
    overdue: j.overdue,
    owner: j.owner,
    ownerColor: j.ownerColor,
    locationCode: j.locationCode,
    locationName: j.locationName,
    locationIndex: j.locationIndex,
    itemSummary: j.itemSummary,
    hasArtwork: j.hasArtwork,
  });
  const jobs = all.map(strip);
  return (
    <TvBoard
      brand={brand}
      location={location ? (locations.find((l) => l.code === location)?.name ?? location) : null}
      dueToday={jobs.filter((j) => j.overdue || j.dueDate === t)}
      rush={jobs.filter((j) => j.priority !== "normal")}
      printing={jobs.filter((j) => ["production", "finishing", "quality_check"].includes(j.status))}
      upNext={jobs.filter((j) => j.status === "approved_for_production")}
      installs={jobs.filter((j) => j.status === "scheduled_install")}
      ready={jobs.filter((j) => j.status === "ready_pickup" || j.status === "scheduled_delivery")}
    />
  );
}
