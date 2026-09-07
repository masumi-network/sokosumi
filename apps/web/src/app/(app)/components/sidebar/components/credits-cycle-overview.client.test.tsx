import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    [key, ...Object.values(values ?? {})].join(" "),
}));

import { CreditsCycleOverview } from "@/app/components/sidebar/components/credits-cycle-overview.client";

const remainingUsage = {
  percentageUsed: 25,
  remaining: 750,
  total: 1_000,
  used: 250,
};

describe("CreditsCycleOverview", () => {
  it("renders nothing without a spendable total or plan-cycle allowance", () => {
    const { container } = render(
      <CreditsCycleOverview
        creditUsage={null}
        totalCredits={null}
        subscriptionPeriodEndMs={null}
        currentTimestampMs={1_700_000_000_000}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows spendable total plus remaining against the cycle cap, not an add-on row", () => {
    render(
      <CreditsCycleOverview
        creditUsage={remainingUsage}
        totalCredits={52_662}
        subscriptionPeriodEndMs={1_700_000_000_000 + 3 * 24 * 60 * 60 * 1000}
        currentTimestampMs={1_700_000_000_000}
      />,
    );

    expect(screen.getByTestId("credits-cycle-overview")).toBeInTheDocument();
    expect(screen.getByTestId("credits-total-available")).toHaveTextContent(
      "totalAvailableHero 52662",
    );
    expect(screen.getByText("totalAvailableLabel")).toBeInTheDocument();
    expect(screen.getByText("monthlyUsageLimit")).toBeInTheDocument();
    expect(screen.getByText("creditsRemainingHero 750")).toBeInTheDocument();
    expect(
      screen.getByText("creditsRemainingOfTotal 750 1000"),
    ).toBeInTheDocument();
    expect(screen.getByText("creditsExpiresInDays 3")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "75",
    );
    expect(screen.queryByText(/extraCredits/)).not.toBeInTheDocument();
    expect(screen.queryByText(/totalBalanceLabel/)).not.toBeInTheDocument();
    expect(screen.queryByText(/creditsUsedOfTotal/)).not.toBeInTheDocument();
  });

  it("keeps spendable total when the period allowance is exhausted", () => {
    render(
      <CreditsCycleOverview
        creditUsage={{
          percentageUsed: 100,
          remaining: 0,
          total: 3_032,
          used: 3_032,
        }}
        totalCredits={51_162}
        subscriptionPeriodEndMs={1_700_000_000_000 + 5 * 24 * 60 * 60 * 1000}
        currentTimestampMs={1_700_000_000_000}
      />,
    );

    expect(screen.getByTestId("credits-total-available")).toHaveTextContent(
      "totalAvailableHero 51162",
    );
    expect(screen.getByTestId("credits-cycle-exhausted")).toHaveTextContent(
      "planAllowanceExhausted",
    );
    expect(
      screen.getByText("creditsRemainingOfTotal 0 3032"),
    ).toBeInTheDocument();
    expect(screen.getByText("creditsExpiresInDays 5")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(screen.queryByText(/creditsRemainingHero/)).not.toBeInTheDocument();
    expect(screen.queryByText(/extraCredits/)).not.toBeInTheDocument();
  });

  it("shows spendable total without a monthly block when there is no period allowance", () => {
    render(
      <CreditsCycleOverview
        creditUsage={null}
        totalCredits={15_750}
        subscriptionPeriodEndMs={null}
        currentTimestampMs={1_700_000_000_000}
      />,
    );

    expect(screen.getByTestId("credits-total-available")).toHaveTextContent(
      "totalAvailableHero 15750",
    );
    expect(screen.queryByText("monthlyUsageLimit")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
