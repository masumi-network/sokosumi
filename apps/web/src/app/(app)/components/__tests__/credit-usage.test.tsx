import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CreditUsage from "@/app/components/credit-usage";
import { useSidebar } from "@/components/ui/sidebar";

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

      if (key === "lowCreditsLabel") {
        return `Low credits ${values?.credits ?? 0}`;
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

vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: vi.fn(() => ({ state: "expanded", isMobile: false })),
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
  beforeEach(() => {
    vi.mocked(useSidebar).mockReturnValue({
      state: "expanded",
      isMobile: false,
    } as ReturnType<typeof useSidebar>);
  });

  it("shows total credits, subscription progress, and extra credits without an extra-credits progress bar", () => {
    render(
      <CreditUsage
        creditUsage={creditUsage}
        extraCredits={25}
        creditsLabel="25 available"
        currentTimestampMs={0}
        lowCreditsThreshold={100}
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
        lowCreditsThreshold={100}
      />,
    );

    expect(screen.getByText("50 credits")).toBeInTheDocument();
    expect(screen.getByTestId("single-progress")).toHaveAttribute(
      "data-value",
      "50",
    );
    expect(screen.queryByText("Extra credits")).not.toBeInTheDocument();
  });

  it("shows total balance in the low-credits trigger label", () => {
    render(
      <CreditUsage
        creditUsage={creditUsage}
        extraCredits={25}
        creditsLabel="25 available"
        currentTimestampMs={0}
        lowCreditsThreshold={100}
      />,
    );

    expect(screen.getByText("Low credits 75")).toBeInTheDocument();
  });

  it("derives low-credits state from total balance shown in the popover", () => {
    render(
      <CreditUsage
        creditUsage={creditUsage}
        extraCredits={25}
        creditsLabel="25 available"
        currentTimestampMs={0}
        lowCreditsThreshold={50}
      />,
    );

    expect(screen.queryByText("Low credits 75")).not.toBeInTheDocument();
    expect(screen.getByText("75 credits")).toBeInTheDocument();
  });

  it("renders a circular progress bar with tooltip label when the sidebar is collapsed", () => {
    vi.mocked(useSidebar).mockReturnValue({
      state: "collapsed",
      isMobile: false,
    } as ReturnType<typeof useSidebar>);

    render(
      <CreditUsage
        creditUsage={creditUsage}
        extraCredits={25}
        creditsLabel="25 available"
        currentTimestampMs={0}
        lowCreditsThreshold={10}
      />,
    );

    const circularProgress = screen.getByTestId("circular-credit-progress");
    expect(circularProgress).toHaveAttribute("aria-valuenow", "50");
    expect(
      screen.getByRole("button", { name: "50 / 100 credits used" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("single-progress")).not.toBeInTheDocument();
  });
});
