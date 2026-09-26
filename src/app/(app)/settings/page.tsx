import Link from "next/link";
import { Building2, ChevronRight, Mail, MapPin, Plug, Scale, SlidersHorizontal, Tags, UserCog } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Settings" };

const CARDS: { href: string; title: string; text: string; icon: LucideIcon }[] = [
  {
    href: "/settings/business-rules",
    title: "Business Rules",
    text: "Minimum charge, design and install rates, rush fee, target margin, sales tax. The numbers every quote starts from.",
    icon: Scale,
  },
  {
    href: "/settings/pricing",
    title: "Pricing Rules",
    text: "How each kind of product is priced — banners by the square foot, business cards by quantity, and so on.",
    icon: Tags,
  },
  {
    href: "/settings/team",
    title: "Team & Permissions",
    text: "Add people, reset passwords, and see what each role is allowed to see.",
    icon: UserCog,
  },
  { href: "/settings/locations", title: "Locations", text: "Your shops and work sites: names, addresses and phone numbers.", icon: MapPin },
  {
    href: "/settings/company",
    title: "Company Profile",
    text: "Name, phone, email, address and hours shown on quotes, invoices and emails.",
    icon: Building2,
  },
  {
    href: "/settings/automations",
    title: "Customer Messages & Automations",
    text: "Reminders and follow-ups for quotes, proofs and invoices. Coming in Phase 2 — nothing is sent automatically yet.",
    icon: Mail,
  },
  { href: "/settings/integrations", title: "Integrations", text: "Email, file storage, QuickBooks, text messages, payments and more.", icon: Plug },
];

export default async function SettingsPage() {
  const user = await requirePagePermission("settings.manage");
  const { company } = await getSettings(user.tenantId);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Settings" subtitle={`How ${company.name || "your business"} runs: rules, prices, people and places.`} />
      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-brand-300 hover:bg-brand-50/30"
          >
            <span className="rounded-lg bg-brand-50 p-2.5 text-brand-600">
              <c.icon className="size-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-lg font-semibold text-slate-900">
                {c.title}
                <ChevronRight className="size-4 text-slate-400 group-hover:text-brand-500" />
              </span>
              <span className="mt-1 block text-[15px] leading-relaxed text-slate-600">{c.text}</span>
            </span>
          </Link>
        ))}
      </div>
      <div className="mt-6">
        <Link
          href="/settings/profile"
          className="inline-flex items-center gap-2 text-[15px] font-medium text-brand-700 hover:underline"
        >
          <SlidersHorizontal className="size-4" /> My own profile, password & notifications
        </Link>
      </div>
    </div>
  );
}
