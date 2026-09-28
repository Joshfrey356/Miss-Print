import { requirePagePermission } from "@/lib/auth";
import { boardJobs } from "@/lib/jobs/queries";
import { today } from "@/lib/format";
import { getLocations } from "@/lib/lookups";
import { getBrand } from "@/lib/brand";
import { ShopProvider } from "@/components/shop-context";
import { loadBlocks, loadMachines } from "@/lib/schedule/queries";
import { dayBounds } from "@/lib/schedule/time";
import { TvBoard } from "./tv-board";
import { MachinesTv } from "./machines-board";

export const metadata = { title: "Production TV" };
export const dynamic = "force-dynamic";

/**
 * Production TV mode: big, glanceable, NO financial information.
 * Open on the shop monitor (signed in as any production account). Refreshes itself.
 * /tv?view=machines shows today's equipment schedule instead of the job board.
 */
export default async function TvPage({ searchParams }: { searchParams: Promise<{ location?: string; view?: string }> }) {
  const user = await requirePagePermission("jobs.view");
  const { location, view } = await searchParams;
  if (view === "machines") {
    const t = today();
    const day = dayBounds(t);
    const [machines, blocks, brand] = await Promise.all([loadMachines(user.tenantId), loadBlocks(user.tenantId, day.start, day.end), getBrand(user.tenantId)]);
    return (
      <ShopProvider value={{ jobPrefix: brand.jobPrefix }}>
        <MachinesTv brand={brand} machines={machines} blocks={blocks.map((b) => ({ ...b, notes: null }))} today={t} />
      </ShopProvider>
    );
  }
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
  // TV mode is outside the signed-in layout, so it provides the shop's job prefix itself.
  return (
    <ShopProvider value={{ jobPrefix: brand.jobPrefix }}>
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
    </ShopProvider>
  );
}
