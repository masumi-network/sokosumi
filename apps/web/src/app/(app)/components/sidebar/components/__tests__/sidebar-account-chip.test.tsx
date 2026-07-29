import type { SessionUser } from "@sokosumi/utils";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    [key, ...Object.values(values ?? {})].join(" "),
}));

const pushMock = vi.fn();
const setOpenMobileMock = vi.fn();
const showLogoutModalMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/components/modals/global-modals-context", () => ({
  useGlobalModalsContext: () => ({ showLogoutModal: showLogoutModalMock }),
}));

const sidebarState = {
  isMobile: false,
  state: "expanded",
  openMobile: false,
};

vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ ...sidebarState, setOpenMobile: setOpenMobileMock }),
}));

import SidebarAccountChip from "@/app/components/sidebar/components/sidebar-account-chip.client";

const sessionUser: SessionUser = {
  id: "user_1",
  name: "Patrick Tobler",
  email: "patrick@example.com",
  emailVerified: true,
  image: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  termsAccepted: true,
  marketingOptIn: false,
  onboardingCompleted: true,
};

function renderChip(
  overrides: Partial<React.ComponentProps<typeof SidebarAccountChip>> = {},
) {
  return render(
    <SidebarAccountChip
      sessionUser={sessionUser}
      planName="Pro"
      totalCredits={15_750}
      extraCredits={750}
      creditUsage={null}
      subscriptionPeriodEndMs={null}
      currentTimestampMs={1_700_000_000_000}
      lowCreditsThreshold={100}
      buyCreditsLabel="getMoreCredits"
      buyCreditsPath="/billing?tab=credits"
      {...overrides}
    />,
  );
}

function openChip() {
  fireEvent.click(screen.getByRole("button", { name: /openSummary/ }));
}

describe("SidebarAccountChip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sidebarState.isMobile = false;
    sidebarState.state = "expanded";
    sidebarState.openMobile = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the plan and the credit balance next to the profile picture", () => {
    renderChip();

    expect(screen.getByText("Patrick Tobler")).toBeInTheDocument();
    expect(
      screen.getByText(/planAndCredits Pro balanceCreditsLabel 15750/),
    ).toBeInTheDocument();
    expect(screen.getByText("PT")).toBeInTheDocument();
  });

  it("flags a balance under the low-credits threshold", () => {
    renderChip({ totalCredits: 42 });

    const summary = screen.getByText(
      /planAndCredits Pro balanceCreditsLabel 42/,
    );

    expect(summary.parentElement?.className).toContain("text-semantic-warning");
  });

  it("leaves an unavailable balance unflagged", () => {
    renderChip({ totalCredits: null, planName: null });

    expect(
      screen.getByText("detailsUnavailable").parentElement?.className,
    ).not.toContain("text-semantic-warning");
  });

  it("hides the usage bar until a subscription period grants credits", () => {
    renderChip();
    openChip();

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/creditsUsedOfTotal/)).not.toBeInTheDocument();
  });

  it("labels the metered allowance as monthly credits", () => {
    renderChip({
      creditUsage: {
        hasUsageData: true,
        percentageUsed: 25,
        remaining: 750,
        total: 1_000,
        used: 250,
      },
    });
    openChip();

    expect(screen.getByText("monthlyCredits")).toBeInTheDocument();
  });

  it("buys credits and logs out from inside the summary", () => {
    renderChip();
    openChip();

    fireEvent.click(screen.getByRole("button", { name: "getMoreCredits" }));

    expect(pushMock).toHaveBeenCalledWith("/billing?tab=credits");

    openChip();
    fireEvent.click(screen.getByRole("button", { name: "logout" }));

    expect(showLogoutModalMock).toHaveBeenCalledWith("patrick@example.com");
  });

  it("reports subscription usage and renewal once the period has credits", () => {
    const currentTimestampMs = 1_700_000_000_000;
    renderChip({
      creditUsage: {
        hasUsageData: true,
        percentageUsed: 25,
        remaining: 750,
        total: 1_000,
        used: 250,
      },
      subscriptionPeriodEndMs: currentTimestampMs + 3 * 24 * 60 * 60 * 1000,
      currentTimestampMs,
    });
    openChip();

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByText(/creditsUsedOfTotal 250 1000/)).toBeInTheDocument();
    expect(screen.getByText(/creditsExpiresInDays 3/)).toBeInTheDocument();
  });

  it("skips the renewal line when the credits response carried no timestamp", () => {
    renderChip({
      creditUsage: {
        hasUsageData: true,
        percentageUsed: 25,
        remaining: 750,
        total: 1_000,
        used: 250,
      },
      subscriptionPeriodEndMs: 1_700_000_000_000,
      currentTimestampMs: 0,
    });
    openChip();

    expect(screen.queryByText(/creditsExpires/)).not.toBeInTheDocument();
  });

  it("closes the summary when the mobile sheet slides shut behind it", () => {
    sidebarState.isMobile = true;
    sidebarState.openMobile = true;
    const { rerender } = renderChip();

    openChip();

    expect(screen.getByRole("button", { name: "logout" })).toBeInTheDocument();

    sidebarState.openMobile = false;
    rerender(
      <SidebarAccountChip
        sessionUser={sessionUser}
        planName="Pro"
        totalCredits={15_750}
        extraCredits={750}
        creditUsage={null}
        subscriptionPeriodEndMs={null}
        currentTimestampMs={1_700_000_000_000}
        lowCreditsThreshold={100}
        buyCreditsLabel="getMoreCredits"
        buyCreditsPath="/billing?tab=credits"
      />,
    );

    expect(
      screen.queryByRole("button", { name: "logout" }),
    ).not.toBeInTheDocument();
  });

  it("shows the browser's offline state on the status dot", () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });

    renderChip();

    expect(screen.getAllByLabelText("offline").length).toBeGreaterThan(0);

    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  it("collapses to an avatar-only trigger that still opens the summary", () => {
    sidebarState.state = "collapsed";
    renderChip();

    expect(screen.getByText("PT")).toBeInTheDocument();
    expect(screen.queryByText("Patrick Tobler")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/planAndCredits Pro balanceCreditsLabel 15750/),
    ).not.toBeInTheDocument();

    openChip();

    expect(screen.getByText("Patrick Tobler")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "logout" })).toBeInTheDocument();
    expect(screen.queryByText(/collapsedSummary/)).not.toBeInTheDocument();
  });

  it("shows extra credits when a metered period and a positive buffer exist", () => {
    renderChip({
      creditUsage: {
        hasUsageData: true,
        percentageUsed: 25,
        remaining: 750,
        total: 1_000,
        used: 250,
      },
      extraCredits: 750,
    });
    openChip();

    expect(screen.getByText("extraCredits")).toBeInTheDocument();
    expect(screen.getByText("balanceCreditsLabel 750")).toBeInTheDocument();
    expect(screen.getByText("extraCreditsDescription")).toBeInTheDocument();
  });

  it("hides the extra-credits block when usage data is missing", () => {
    renderChip({
      creditUsage: null,
      extraCredits: 750,
    });
    openChip();

    expect(screen.queryByText("extraCredits")).not.toBeInTheDocument();
    expect(
      screen.queryByText("extraCreditsDescription"),
    ).not.toBeInTheDocument();
  });
});
