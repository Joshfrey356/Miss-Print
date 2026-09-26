"use client";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MoneyInput } from "@/components/ui/input";
import { centsToInput } from "@/lib/format";
import type { BusinessRules } from "@/lib/pricing/engine";
import { ActionForm, SaveButton } from "../_components/action-form";
import { RuleRow, SuffixInput } from "../_components/inputs";
import { saveBusinessRules } from "../actions";

const pctInput = (v: number) => String(Math.round(v * 10000) / 100);

export function BusinessRulesForm({ rules, quoteValidDays }: { rules: BusinessRules; quoteValidDays: number }) {
  return (
    <ActionForm action={saveBusinessRules} className="space-y-5">
      <Card>
        <CardHeader title="What we charge" description="Rates added to quotes when the work needs them." />
        <CardBody className="py-0">
          <RuleRow htmlFor="minimumCharge" label="Minimum charge" help="The smallest amount we charge for any line on a quote, even a tiny job.">
            <MoneyInput id="minimumCharge" name="minimumCharge" defaultValue={centsToInput(rules.minimumChargeCents)} required />
          </RuleRow>
          <RuleRow htmlFor="designRate" label="Design rate (per hour)" help="What we charge the customer for each hour of design work.">
            <MoneyInput id="designRate" name="designRate" defaultValue={centsToInput(rules.designRateCents)} required />
          </RuleRow>
          <RuleRow htmlFor="installRate" label="Installation rate (per hour)" help="What we charge for each hour of installation at the customer's site.">
            <MoneyInput id="installRate" name="installRate" defaultValue={centsToInput(rules.installRateCents)} required />
          </RuleRow>
          <RuleRow htmlFor="mileageRate" label="Mileage rate (per mile)" help="Charged for driving to installs and deliveries.">
            <MoneyInput id="mileageRate" name="mileageRate" defaultValue={centsToInput(rules.mileageRateCents)} required />
          </RuleRow>
          <RuleRow htmlFor="rushPct" label="Rush fee" help="Added on top of the price when the customer needs it faster than normal.">
            <SuffixInput id="rushPct" name="rushPct" suffix="%" defaultValue={pctInput(rules.rushPct)} required />
          </RuleRow>
          <RuleRow
            htmlFor="outsourcedMarkupPct"
            label="Markup on outside work"
            help="Added to what an outside vendor charges us (e.g. a sign cabinet) before it goes on the quote."
          >
            <SuffixInput id="outsourcedMarkupPct" name="outsourcedMarkupPct" suffix="%" defaultValue={pctInput(rules.outsourcedMarkupPct)} required />
          </RuleRow>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="What it costs us" description="Used to work out real profit on each job. Customers never see this." />
        <CardBody className="py-0">
          <RuleRow
            htmlFor="laborCost"
            label="Labor cost (per hour)"
            help="What an hour of an employee's time really costs us, including wages and taxes."
          >
            <MoneyInput id="laborCost" name="laborCost" defaultValue={centsToInput(rules.laborCostPerHourCents)} required />
          </RuleRow>
          <RuleRow
            htmlFor="targetMarginPct"
            label="Target gross margin"
            help="How much of each sale should be left after materials and labor. Quotes below this get a warning."
          >
            <SuffixInput id="targetMarginPct" name="targetMarginPct" suffix="%" defaultValue={pctInput(rules.targetMarginPct)} required />
          </RuleRow>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Tax & quotes" />
        <CardBody className="py-0">
          <RuleRow htmlFor="taxRate" label="Sales tax rate" help="Indiana sales tax added to taxable items. Tax-exempt customers are skipped.">
            <SuffixInput id="taxRate" name="taxRate" suffix="%" defaultValue={pctInput(rules.taxRate)} required />
          </RuleRow>
          <RuleRow htmlFor="quoteValidDays" label="Quotes are good for" help="After this many days a quote expires and the price may change.">
            <SuffixInput id="quoteValidDays" name="quoteValidDays" suffix="days" inputMode="numeric" defaultValue={String(quoteValidDays)} required />
          </RuleRow>
        </CardBody>
      </Card>

      <div className="sticky bottom-20 z-10 flex items-center justify-end gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur lg:bottom-4">
        <p className="mr-auto hidden text-sm text-slate-500 sm:block">Changes apply to new quotes. Existing quotes keep their prices.</p>
        <SaveButton size="lg" pendingText="Saving…">
          Save business rules
        </SaveButton>
      </div>
    </ActionForm>
  );
}
