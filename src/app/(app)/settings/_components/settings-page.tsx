import * as React from "react";
import { PageHeader } from "@/components/ui/page-header";

/** Standard frame for a Settings sub-page. */
export function SettingsPage({
  title,
  subtitle,
  actions,
  children,
  back = { href: "/settings", label: "Settings" },
  wide,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  back?: { href: string; label: string } | null;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "mx-auto max-w-6xl" : "mx-auto max-w-3xl"}>
      <PageHeader title={title} subtitle={subtitle} actions={actions} back={back ?? undefined} />
      {children}
    </div>
  );
}
