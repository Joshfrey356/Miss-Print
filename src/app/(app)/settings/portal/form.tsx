"use client";
import * as React from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Input, Textarea } from "@/components/ui/input";
import { MAX_WELCOME, PORTAL_FEATURES, type PortalSettings } from "@/lib/portal/config";
import { ActionForm, SaveButton } from "../_components/action-form";
import { savePortalSettings } from "./actions";

export function PortalSettingsForm({ settings, address, stripeConnected }: { settings: PortalSettings; address: string; stripeConnected: boolean }) {
  const [on, setOn] = React.useState(settings.enabled);
  const [copied, setCopied] = React.useState(false);
  return (
    <ActionForm action={savePortalSettings} className="space-y-6">
      <Card>
        <CardHeader title="Portal" action={on ? <Badge tone="green">On</Badge> : <Badge tone="gray">Off</Badge>} />
        <CardBody className="space-y-4">
          <Checkbox
            name="enabled"
            checked={on}
            onChange={(e) => setOn(e.target.checked)}
            label={<span className="font-semibold">Customers can use the portal</span>}
            hint="Off: nobody can sign in, sign-in links stop working, and quote emails don't include a portal link."
          />
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">Your portal address</p>
            <div className="flex gap-2">
              <Input readOnly value={address} onFocus={(e) => e.currentTarget.select()} className="font-mono text-sm" aria-label="Portal address" />
              <Button
                type="button"
                onClick={() => navigator.clipboard?.writeText(address).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })}
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy"}
              </Button>
              <a href={address} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg px-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Open the portal">
                <ExternalLink className="size-4" />
              </a>
            </div>
            <p className="mt-1.5 text-sm text-slate-500">
              Put it on your website or in your email signature. Customers sign in with the email on their customer record (or a contact&apos;s email) — we email them a sign-in link, no password. You can also invite people from a customer&apos;s page. To see it yourself, open any customer and press <strong>Preview portal</strong> (your staff email can&apos;t sign in here).
            </p>
          </div>
          <div>
            <label htmlFor="welcome" className="mb-1.5 block text-sm font-medium text-slate-700">
              Welcome message <span className="font-normal text-slate-500">(optional, shown on the portal home page)</span>
            </label>
            <Textarea id="welcome" name="welcome" rows={3} maxLength={MAX_WELCOME} defaultValue={settings.welcome} placeholder="Thanks for choosing us! Orders placed by 2 pm ship the next business day." />
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="What customers can do" description="Turn off anything you'd rather handle by phone or email. Checking orders and approving proofs are always on." />
        <CardBody className="divide-y divide-slate-100 py-0">
          {PORTAL_FEATURES.map((f) => (
            <div key={f.key} className="py-3.5">
              <Checkbox
                name={`f_${f.key}`}
                defaultChecked={settings.features[f.key]}
                disabled={!on}
                label={
                  <span className="flex flex-wrap items-center gap-2 font-semibold">
                    {f.label}
                    {f.key === "pay" && (stripeConnected ? <Badge tone="green">Stripe connected</Badge> : <Badge tone="amber">Stripe not connected</Badge>)}
                  </span>
                }
                hint={f.key === "pay" && !stripeConnected ? `${f.help} Until then, customers see your phone number to call and pay.` : f.help}
              />
              {f.key === "pay" && !stripeConnected && (
                <Link href="/settings/integrations" className="ml-7 mt-1 inline-block text-sm font-medium text-brand-700 hover:underline">
                  Connect card payments
                </Link>
              )}
            </div>
          ))}
        </CardBody>
        {/* Disabled checkboxes aren't submitted: keep the saved choices while the portal is off. */}
        {!on && PORTAL_FEATURES.filter((f) => settings.features[f.key]).map((f) => <input key={f.key} type="hidden" name={`f_${f.key}`} value="on" />)}
      </Card>
      <div className="flex justify-end">
        <SaveButton>Save portal settings</SaveButton>
      </div>
    </ActionForm>
  );
}
