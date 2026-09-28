import { asc, desc, eq } from "drizzle-orm";
import { Check } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { locations, users } from "@/lib/db/schema";
import { getLocations } from "@/lib/lookups";
import { ROLE_LABELS } from "@/lib/permissions";
import { PERMISSION_INFO, ROLES, roleMatrix } from "@/lib/admin/roles";
import { timeAgo } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { SettingsPage } from "../_components/settings-page";
import { AddUserButton, UserActions } from "./team-client";

export const metadata = { title: "Team & Permissions" };

export default async function TeamPage() {
  const me = await requirePagePermission("users.manage");
  const [rows, locs] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        handle: users.handle,
        email: users.email,
        role: users.role,
        title: users.title,
        phone: users.phone,
        color: users.color,
        active: users.active,
        locationId: users.locationId,
        location: locations.name,
        lastLoginAt: users.lastLoginAt,
        invitedAt: users.invitedAt,
      })
      .from(users)
      .leftJoin(locations, eq(locations.id, users.locationId))
      .where(eq(users.tenantId, me.tenantId))
      .orderBy(desc(users.active), asc(users.name)),
    getLocations(me.tenantId),
  ]);
  const locOptions = locs.map((l) => ({ id: l.id, name: l.name }));
  const matrix = roleMatrix();
  const activeCount = rows.filter((r) => r.active).length;

  return (
    <SettingsPage
      wide
      title="Team & Permissions"
      subtitle={`${activeCount} active ${activeCount === 1 ? "person" : "people"}. People are never deleted — deactivate them so their history stays.`}
      actions={<AddUserButton locations={locOptions} />}
    >
      <Card>
        <Table>
          <THead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th className="hidden md:table-cell">Email</Th>
              <Th className="hidden lg:table-cell">Location</Th>
              <Th className="hidden sm:table-cell">Last signed in</Th>
              <Th className="text-right" aria-label="Actions" />
            </tr>
          </THead>
          <tbody>
            {rows.map((u) => (
              <Tr key={u.id} className={u.active ? "" : "bg-slate-50 text-slate-500"}>
                <Td>
                  <div className="flex items-center gap-3">
                    <Avatar name={u.name} color={u.active ? u.color : "#94a3b8"} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                        {u.name}
                        {u.id === me.id && <Badge tone="blue">You</Badge>}
                        {!u.active && <Badge tone="red">Deactivated</Badge>}
                      </div>
                      <div className="text-sm text-slate-500">
                        @{u.handle}
                        {u.title ? ` · ${u.title}` : ""}
                      </div>
                    </div>
                  </div>
                </Td>
                <Td className="whitespace-nowrap">{ROLE_LABELS[u.role]}</Td>
                <Td className="hidden md:table-cell">{u.email}</Td>
                <Td className="hidden lg:table-cell">{u.location ?? "—"}</Td>
                <Td className="hidden whitespace-nowrap sm:table-cell">
                  {u.lastLoginAt ? timeAgo(u.lastLoginAt) : u.invitedAt && u.active ? <Badge tone="amber">Invited {timeAgo(u.invitedAt)}</Badge> : "Never"}
                </Td>
                <Td className="text-right">
                  <UserActions
                    user={{
                      id: u.id,
                      name: u.name,
                      handle: u.handle,
                      email: u.email,
                      role: u.role,
                      title: u.title,
                      phone: u.phone,
                      locationId: u.locationId,
                      active: u.active,
                      signedIn: Boolean(u.lastLoginAt),
                    }}
                    isMe={u.id === me.id}
                    locations={locOptions}
                  />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card className="mt-8">
        <CardHeader
          title="What each role can see"
          description="Set by the role you give each person. Money, costs and margins are hidden on the server for roles without a check mark."
        />
        <div className="grid gap-3 border-b border-slate-100 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
          {matrix.map((r) => (
            <div key={r.role}>
              <p className="font-semibold text-slate-900">{r.label}</p>
              <p className="text-sm text-slate-500">{r.description}</p>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/60 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky left-0 z-10 bg-slate-50 px-4 py-2.5">Can…</th>
                {matrix.map((r) => (
                  <th key={r.role} className="px-3 py-2.5 text-center whitespace-nowrap">
                    {r.label.replace(" / Front Counter", "").replace(" / Admin", "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_INFO.map((g) => (
                <GroupRows key={g.group} group={g} matrix={matrix} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </SettingsPage>
  );
}

function GroupRows({ group, matrix }: { group: (typeof PERMISSION_INFO)[number]; matrix: ReturnType<typeof roleMatrix> }) {
  return (
    <>
      <tr className="border-t border-slate-200 bg-slate-50/40">
        <td colSpan={ROLES.length + 1} className="sticky left-0 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {group.group}
        </td>
      </tr>
      {group.items.map((p) => (
        <tr key={p.key} className="border-t border-slate-100">
          <td className="sticky left-0 z-10 bg-white px-4 py-2 text-[15px] text-slate-800">{p.label}</td>
          {matrix.map((r) => (
            <td key={r.role} className="px-3 py-2 text-center">
              {r.permissions.includes(p.key) ? (
                <Check className="mx-auto size-5 text-emerald-600" aria-label="Yes" />
              ) : (
                <span className="text-slate-300" aria-label="No">
                  —
                </span>
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
