import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import CreditUsage from "@/app/components/credit-usage";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    if (namespace === "App.Billing") {
      return (key: string, values?: { credits?: number }) => {
        if (key === "balanceCreditsLabel") {
          const credits = values?.credits ?? 0;
          if (credits === 0) {
            return "No credits";
          }
          if (credits === 1) {
            return "1 credit";
          }
          return `${credits} credits`;
        }
        return key;
      };
    }

    return (key: string, values?: Record<string, number>) => {
      if (key === "creditsConsumedProgressAria") {
        return "Subscription credits consumed";
      }

      if (key === "creditsUsedOfTotal") {
        return `${values?.used ?? 0} / ${values?.total ?? 0} credits used`;
      }

      if (key === "creditsExpiresInDays") {
        return `Credits renew in ${values?.days ?? 0} days`;
      }

      if (key === "monthlyUsageLimit") {
        return "Monthly usage limit";
      }

      if (key === "totalBalanceLabel") {
        return "Total balance";
      }

      if (key === "extraCredits") {
        return "Extra credits";
      }

      if (key === "extraCreditsDescription") {
        return "Never expire";
      }

      if (key === "creditsExpiresToday") {
        return "Credits renew today";
      }

      if (key === "creditsExpired") {
        return "Credits expired";
      }

      return key;
    };
  },
}));

vi.mock("@/components/ui/progress", () => ({
  Progress: ({
    value,
    ...props
  }: {
    value?: number;
    "aria-label"?: string;
    className?: string;
  }) => <div data-testid="single-progress" data-value={value} {...props} />,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => children,
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverTrigger: ({ children }: { children: ReactNode }) => children,
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

const creditUsage = {
  hasUsageData: true,
  percentageUsed: 50,
  remaining: 50,
  total: 100,
  used: 50,
} as const;

describe("CreditUsage", () => {
  it("shows total credits, subscription progress, and extra credits without an extra-credits progress bar", () => {
    render(
      <CreditUsage
        creditUsage={creditUsage}
        extraCredits={25}
        creditsLabel="25 available"
        currentTimestampMs={0}
      />,
    );

    expect(screen.getByText("Total balance")).toBeInTheDocument();
    expect(screen.getByText("75 credits")).toBeInTheDocument();
    expect(screen.getByText("Extra credits")).toBeInTheDocument();
    expect(screen.getByText("25 available")).toBeInTheDocument();
    expect(screen.getByText("Never expire")).toBeInTheDocument();

    expect(screen.getByTestId("single-progress")).toHaveAttribute(
      "data-value",
      "50",
    );

    const subscriptionBars = screen.getAllByRole("progressbar", {
      name: "Subscription credits consumed",
    });
    expect(subscriptionBars).toHaveLength(1);
    expect(subscriptionBars[0]).toHaveStyle({ width: "50%" });
  });

  it("falls back to the shared progress bar when extra credits are empty", () => {
    render(
      <CreditUsage
        creditUsage={creditUsage}
        extraCredits={0}
        creditsLabel="0 available"
        currentTimestampMs={0}
      />,
    );

    expect(screen.getByText("50 credits")).toBeInTheDocument();
    expect(screen.getByTestId("single-progress")).toHaveAttribute(
      "data-value",
      "50",
    );
    expect(screen.queryByText("Extra credits")).not.toBeInTheDocument();
  });
});
