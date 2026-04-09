import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { PaidSubscriptionPlanView } from "@/components/billing/subscription-plan-utils";
import { OnboardingPlanRadioGrid } from "@/components/onboarding/onboarding-plan-radio-grid";
import type { PaidSubscriptionPlanName } from "@/lib/stripe/subscription-catalog";

const basePlans: PaidSubscriptionPlanView[] = [
  {
    credits: 250,
    currency: "usd",
    isCurrent: false,
    monthlyAmount: 1900,
    name: "starter",
  },
  {
    credits: 750,
    currency: "usd",
    isCurrent: false,
    monthlyAmount: 4900,
    name: "standard",
  },
  {
    credits: 2000,
    currency: "usd",
    isCurrent: false,
    monthlyAmount: 9900,
    name: "pro",
  },
];

const translationValues: Record<string, string> = {
  "Plans.starter.name": "Starter",
  "Plans.starter.description": "For freelancers.",
  "Plans.starter.features.title": "Starter includes",
  "Plans.standard.name": "Standard",
  "Plans.standard.description": "Best for growing teams.",
  "Plans.standard.features.title": "Standard includes",
  "Plans.pro.name": "Pro",
  "Plans.pro.description": "For power users.",
  "Plans.pro.features.title": "Pro includes",
  pricePerMonth: "per month",
  freePrice: "Free",
  currentPlanBadge: "Current",
  mostPopularBadge: "Most popular",
};

const rawTranslations: Record<string, Record<string, string>> = {
  "Plans.starter.features.items": {
    item1: "Starter feature 1",
    item2: "Starter feature 2",
    item3: "Starter feature 3",
    item4: "Starter feature 4",
  },
  "Plans.standard.features.items": {
    item1: "Standard feature 1",
    item2: "Standard feature 2",
    item3: "Standard feature 3",
  },
  "Plans.pro.features.items": {
    item1: "Pro feature 1",
    item2: "Pro feature 2",
    item3: "Pro feature 3",
  },
};

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    number: (value: number) => `$${value}`,
  }),
  useTranslations: () => {
    const translator = (key: string, values?: { credits?: number }) => {
      if (key === "includedCredits") {
        return `${values?.credits ?? 0} credits included`;
      }

      return translationValues[key] ?? key;
    };

    translator.raw = (key: string) => rawTranslations[key] ?? {};

    return translator;
  },
}));

interface TestHarnessProps {
  initialPlan?: PaidSubscriptionPlanName;
  plans?: PaidSubscriptionPlanView[];
}

function TestHarness({
  initialPlan = "standard",
  plans = basePlans,
}: TestHarnessProps) {
  const [selectedPlan, setSelectedPlan] =
    useState<PaidSubscriptionPlanName>(initialPlan);

  return (
    <OnboardingPlanRadioGrid
      plans={plans}
      value={selectedPlan}
      onValueChange={setSelectedPlan}
    />
  );
}

describe("OnboardingPlanRadioGrid", () => {
  it("defaults to the standard plan, highlights it, and trims feature bullets", () => {
    render(<TestHarness />);

    expect(screen.getByRole("radio", { name: "Standard" })).toHaveAttribute(
      "data-state",
      "checked",
    );
    expect(screen.getByText("Most popular")).toBeInTheDocument();
    expect(screen.getByText("Starter feature 3")).toBeInTheDocument();
    expect(screen.queryByText("Starter feature 4")).not.toBeInTheDocument();
  });

  it("marks the current plan and disables selecting it", async () => {
    const user = userEvent.setup();
    const plans = basePlans.map((plan) => ({
      ...plan,
      isCurrent: plan.name === "standard",
    }));

    render(<TestHarness initialPlan="starter" plans={plans} />);

    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.queryByText("Most popular")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Standard" })).toBeDisabled();

    await user.click(screen.getByText("Standard"));

    expect(screen.getByRole("radio", { name: "Starter" })).toHaveAttribute(
      "data-state",
      "checked",
    );
    expect(screen.getByRole("radio", { name: "Standard" })).toHaveAttribute(
      "data-state",
      "unchecked",
    );
  });

  it("updates the selected plan when a different card is clicked", async () => {
    const user = userEvent.setup();

    render(<TestHarness />);

    await user.click(screen.getByText("Starter"));

    expect(screen.getByRole("radio", { name: "Starter" })).toHaveAttribute(
      "data-state",
      "checked",
    );
    expect(screen.getByRole("radio", { name: "Standard" })).toHaveAttribute(
      "data-state",
      "unchecked",
    );
  });
});
