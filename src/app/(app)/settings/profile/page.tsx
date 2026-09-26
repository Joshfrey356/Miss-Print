import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { locations, users } from "@/lib/db/schema";
import { NOTIFICATION_KINDS } from "@/lib/notifications";
import { ROLE_LABELS } from "@/lib/permissions";
import { SettingsPage } from "../_components/settings-page";
import { NotificationsForm, PasswordForm, ProfileForm } from "./forms";

export const metadata = { title: "My Profile" };

export default async function ProfilePage() {
  const me = await requireUser();
  const [row] = await db
    .select({ name: users.name, phone: users.phone, email: users.email, prefs: users.notificationPrefs, location: locations.name })
    .from(users)
    .leftJoin(locations, eq(locations.id, users.locationId))
    .where(eq(users.id, me.id));
  const kinds = Object.entries(NOTIFICATION_KINDS).map(([key, label]) => ({ key, label, on: row?.prefs?.[key] !== false }));
  return (
    <SettingsPage
      title="My Profile"
      subtitle={
        <>
          {ROLE_LABELS[me.role]}
          {row?.location ? ` · ${row.location}` : ""} · {row?.email}
        </>
      }
      back={null}
    >
      <div className="space-y-5">
        <ProfileForm name={row?.name ?? me.name} phone={row?.phone ?? ""} handle={me.handle} />
        <NotificationsForm kinds={kinds} />
        <PasswordForm />
      </div>
    </SettingsPage>
  );
}
