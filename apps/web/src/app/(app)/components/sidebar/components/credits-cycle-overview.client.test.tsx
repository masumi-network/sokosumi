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
  it("renders nothing without additional credits or a plan-cycle allowance", () => {
    const { container } = render(
      <CreditsCycleOverview
        creditUsage={null}
        extraCredits={null}
        subscriptionPeriodEndMs={null}
        currentTimestampMs={1_700_000_000_000}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("hides the additional-credits block when extra remaining is 0", () => {
    render(
      <CreditsCycleOverview
        creditUsage={remainingUsage}
        extraCredits={0}
        subscriptionPeriodEndMs={1_700_000_000_000 + 3 * 24 * 60 * 60 * 1000}
        currentTimestampMs={1_700_000_000_000}
      />,
    );

    expect(screen.getByTestId("credits-cycle-overview")).toBeInTheDocument();
    expect(
      screen.queryByTestId("credits-overview-separator"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("credits-additional")).not.toBeInTheDocument();
    expect(screen.getByText("monthlyUsageLimit")).toBeInTheDocument();
    expect(screen.getByText("creditsRemainingHero 750")).toBeInTheDocument();
  });

  it("shows additional credits plus remaining against the cycle cap, not a spendable-total or extra row", () => {
    render(
      <CreditsCycleOverview
        creditUsage={remainingUsage}
        extraCredits={51_162}
        subscriptionPeriodEndMs={1_700_000_000_000 + 3 * 24 * 60 * 60 * 1000}
        currentTimestampMs={1_700_000_000_000}
      />,
    );

    expect(screen.getByTestId("credits-cycle-overview")).toBeInTheDocument();
    const monthlyHeading = screen.getByText("monthlyUsageLimit");
    const additional = screen.getByTestId("credits-additional");
    const separator = screen.getByTestId("credits-overview-separator");
    expect(
      monthlyHeading.compareDocumentPosition(separator) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      separator.compareDocumentPosition(additional) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const additionalHeading = screen.getByText("additionalCreditsLabel");
    expect(additionalHeading.className).toContain("text-muted-foreground");
    expect(additionalHeading.className).toContain("text-xs");
    expect(additionalHeading.className).toContain("font-medium");
    expect(monthlyHeading.className).toContain("text-muted-foreground");
    expect(monthlyHeading.className).toContain("text-xs");
    const remainingHero = screen.getByText("creditsRemainingHero 750");
    expect(remainingHero.className).toContain("text-sm");
    expect(remainingHero.className).toContain("tabular-nums");
    expect(remainingHero.className).not.toContain("text-lg");
    expect(remainingHero.className).not.toContain("font-semibold");
    const additionalHero = screen.getByText("additionalCreditsHero 51162");
    expect(additionalHero.className).toContain("text-muted-foreground");
    expect(additionalHero.className).toContain("text-sm");
    expect(additionalHero.className).not.toContain("text-lg");
    expect(additionalHero.className).not.toContain("font-semibold");
    expect(
      additionalHeading.compareDocumentPosition(additionalHero) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(additional).toHaveTextContent("additionalCreditsHero 51162");
    expect(screen.getByText("creditsRemainingHero 750")).toBeInTheDocument();
    expect(
      screen.getByText("creditsRemainingOfTotal 750 1000"),
    ).toBeInTheDocument();
    expect(screen.getByText("creditsExpiresInDays 3")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "75",
    );
    expect(
      screen.queryByText(/extraCreditsDescription/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/totalAvailableLabel/)).not.toBeInTheDocument();
    expect(screen.queryByText(/totalBalanceLabel/)).not.toBeInTheDocument();
    expect(screen.queryByText(/creditsUsedOfTotal/)).not.toBeInTheDocument();
  });

  it("keeps additional credits when the period allowance is exhausted", () => {
    render(
      <CreditsCycleOverview
        creditUsage={{
          percentageUsed: 100,
          remaining: 0,
          total: 3_032,
          used: 3_032,
        }}
        extraCredits={51_162}
        subscriptionPeriodEndMs={1_700_000_000_000 + 5 * 24 * 60 * 60 * 1000}
        currentTimestampMs={1_700_000_000_000}
      />,
    );

    expect(screen.getByTestId("credits-additional")).toHaveTextContent(
      "additionalCreditsHero 51162",
    );
    expect(screen.getByText("monthlyUsageLimit")).toBeInTheDocument();
    expect(
      screen.getByText("creditsRemainingOfTotal 0 3032"),
    ).toBeInTheDocument();
    expect(screen.getByText("creditsExpiresInDays 5")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(screen.queryByText(/creditsRemainingHero/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/planAllowanceExhausted/),
    ).not.toBeInTheDocument();
  });

  it("shows additional credits without a monthly block when there is no period allowance", () => {
    render(
      <CreditsCycleOverview
        creditUsage={null}
        extraCredits={15_750}
        subscriptionPeriodEndMs={null}
        currentTimestampMs={1_700_000_000_000}
      />,
    );

    expect(screen.getByTestId("credits-additional")).toHaveTextContent(
      "additionalCreditsHero 15750",
    );
    expect(
      screen.queryByTestId("credits-overview-separator"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("monthlyUsageLimit")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
