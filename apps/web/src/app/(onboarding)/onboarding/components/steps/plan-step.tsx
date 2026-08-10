"use client";

import type { PaidSubscriptionPlanName } from "@sokosumi/utils";
import { useFormatter, useTranslations } from "next-intl";

import {
  OrganizationSeatSettingsFields,
  resolveTargetOrganizationSeats,
} from "@/components/billing/organization-seat-settings-fields";
import { formatPlanPrice } from "@/components/billing/subscription-plan-presentation";
import {
  getPlanTranslationKey,
  type PaidSubscriptionPlanView,
} from "@/components/billing/subscription-plan-utils";

import { OptionList } from "../option-list";
import { StepShell } from "../step-shell";

export interface OnboardingOrganizationContext {
  id: string;
  /** Members already occupying a seat; a freshly created org is just the owner. */
  memberCount: number;
  name: string;
}

interface PlanStepProps {
  onSelectedPlanChange: (value: PaidSubscriptionPlanName) => void;
  onTargetSeatsChange: (value: number) => void;
  organization: OnboardingOrganizationContext | null;
  plans: PaidSubscriptionPlanView[];
  selectedPlan: PaidSubscriptionPlanName;
  targetSeats: number;
}

/** Seats already assigned in a brand-new organization: only the owner. */
export const NEW_ORGANIZATION_ASSIGNED_SEATS = 1;

export function resolveInitialOnboardingSeats(memberCount: number): number {
  return resolveTargetOrganizationSeats(
    Math.max(memberCount, NEW_ORGANIZATION_ASSIGNED_SEATS),
    NEW_ORGANIZATION_ASSIGNED_SEATS,
  );
}

/**
 * Plans as rows, not pricing cards.
 *
 * The marketing-style comparison grid belongs on the billing page, where the
 * user is deciding whether to pay at all. Here the plan is one more answer in
 * a sequence of answers, and it is skippable — so it reads as a list like
 * every other question.
 */
export function PlanStep({
  onSelectedPlanChange,
  onTargetSeatsChange,
  organization,
  plans,
  selectedPlan,
  targetSeats,
}: PlanStepProps) {
  const t = useTranslations("Onboarding.Flow.Plan");
  const tSubscriptions = useTranslations("App.Subscriptions");
  const formatter = useFormatter();

  return (
    <StepShell
      subtitle={
        organization
          ? t("subtitleOrganization", { organization: organization.name })
          : t("subtitlePersonal")
      }
      title={t("title")}
    >
      <div className="mx-auto mt-8 w-full max-w-md space-y-4">
        <OptionList
          items={plans.map((plan) => {
            const translationKey = getPlanTranslationKey(plan.name);

            return {
              label: tSubscriptions(`Plans.${translationKey}.name`),
              meta: t("perMonth", {
                price: formatPlanPrice({
                  formatCurrency: (amount) =>
                    formatter.number(amount, {
                      style: "currency",
                      currency: plan.currency.toUpperCase(),
                    }),
                  freePriceLabel: tSubscriptions("freePrice"),
                  monthlyAmount: plan.monthlyAmount,
                }),
              }),
              secondary: tSubscriptions("includedCredits", {
                credits: plan.credits,
              }),
              value: plan.name,
            };
          })}
          onSelect={onSelectedPlanChange}
          value={selectedPlan}
        />

        {organization ? (
          <div className="bg-card rounded-xl border p-4">
            <OrganizationSeatSettingsFields
              assignedSeatCount={NEW_ORGANIZATION_ASSIGNED_SEATS}
              inputId="onboarding-organization-seats"
              memberCount={organization.memberCount}
              onTargetSeatsChange={onTargetSeatsChange}
              targetSeats={targetSeats}
            />
          </div>
        ) : null}
      </div>
    </StepShell>
  );
}
