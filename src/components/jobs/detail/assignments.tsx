"use client";
import { useServerAction } from "@/components/use-action";
import { Avatar } from "@/components/ui/avatar";
import { assignJob } from "@/app/(app)/jobs/actions";
import type { Role } from "@/lib/db/schema";

type Person = { id: number; name: string; role: Role; color: string };
type Field = "salespersonId" | "designerId" | "productionId" | "installerId";

const ROWS: { field: Field; label: string; roles: Role[] }[] = [
  { field: "salespersonId", label: "Sales", roles: ["owner", "manager", "sales"] },
  { field: "designerId", label: "Designer", roles: ["designer", "owner", "manager"] },
  { field: "productionId", label: "Production", roles: ["production", "manager", "owner"] },
  { field: "installerId", label: "Installer", roles: ["installer", "production", "manager"] },
];

export function Assignments({ jobId, values, people, canEdit, needsInstall }: { jobId: number; values: Record<Field, number | null>; people: Person[]; canEdit: boolean; needsInstall: boolean }) {
  const [pending, run] = useServerAction();
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      {ROWS.filter((r) => r.field !== "installerId" || needsInstall || values.installerId).map((r) => {
        const current = people.find((p) => p.id === values[r.field]);
        const options = people.filter((p) => r.roles.includes(p.role) || p.id === values[r.field]);
        return (
          <div key={r.field}>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{r.label}</dt>
            <dd className="mt-1 flex items-center gap-2">
              {current && <Avatar name={current.name} color={current.color} size="sm" />}
              {canEdit ? (
                <select
                  disabled={pending}
                  value={values[r.field] ?? ""}
                  onChange={(e) => run(() => assignJob(jobId, r.field, e.target.value ? Number(e.target.value) : null))}
                  className="-ml-1 min-w-0 flex-1 cursor-pointer rounded-md border-0 bg-transparent py-1 pl-1 pr-6 text-[15px] font-medium text-slate-800 hover:bg-slate-100"
                >
                  <option value="">Unassigned</option>
                  {options.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[15px] font-medium text-slate-800">{current?.name ?? "Unassigned"}</span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
