import type { SessionUser } from "@sokosumi/utils";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    [key, ...Object.values(values ?? {})].join(" "),
}));

const pushMock = vi.fn();
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
};

vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ ...sidebarState }),
}));

vi.mock("@/components/ui/popover", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/popover")>();
  const { createAccountSummaryPopoverMock } = await import(
    "@/app/components/sidebar/components/__tests__/account-summary-popover-test-utils"
  );
  return createAccountSummaryPopoverMock(actual);
});

import { SidebarAccountChip } from "@/app/components/sidebar/components/sidebar-account-chip.client";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";

import {
  accountSummaryPopoverTestFlags,
  resetAccountSummaryPopoverTestFlags,
} from "./account-summary-popover-test-utils";

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
};

const members: MemberWithOrganization[] = [];

const defaultAdminSettingsChrome = {
  adminMenuEnabled: true,
  members,
  activeOrganizationId: null as string | null,
  showDeveloperVendors: false,
};

function renderChip(
  overrides: Partial<React.ComponentProps<typeof SidebarAccountChip>> = {},
) {
  return render(
    <SidebarAccountChip
      sessionUser={sessionUser}
      planName="Pro"
      totalCredits={15_750}
      creditUsage={null}
      subscriptionPeriodEndMs={null}
      currentTimestampMs={1_700_000_000_000}
      lowCreditsThreshold={100}
      buyCreditsLabel="getMoreCredits"
      buyCreditsPath="/billing?tab=credits"
      adminSettingsChrome={defaultAdminSettingsChrome}
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
    resetAccountSummaryPopoverTestFlags();
  });

  afterEach(() => {
    resetAccountSummaryPopoverTestFlags();
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

  it("keeps name line-height above 1 so truncate does not clip descenders", () => {
    renderChip({
      sessionUser: {
        ...sessionUser,
        name: "Andreas Osberghaus",
      },
    });

    const name = screen.getByText("Andreas Osberghaus");
    expect(name.className).toContain("leading-tight");
    expect(name.className).not.toContain("leading-none");
    expect(name.className).toContain("truncate");
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
    expect(
      screen.queryByText(/creditsRemainingOfTotal/),
    ).not.toBeInTheDocument();
  });

  it("labels the metered allowance as a monthly usage limit", () => {
    renderChip({
      creditUsage: {
        percentageUsed: 25,
        remaining: 750,
        total: 1_000,
        used: 250,
      },
    });
    openChip();

    expect(screen.getByText("monthlyUsageLimit")).toBeInTheDocument();
  });

  it("shows Admin and Settings before Logout when admin is enabled", () => {
    renderChip();
    openChip();

    expect(screen.queryByRole("button", { name: "drive" })).toBeNull();

    const admin = screen.getByRole("button", { name: "admin" });
    const settings = screen.getByRole("button", { name: "settings" });
    const logout = screen.getByRole("button", { name: "logout" });

    expect(
      admin.compareDocumentPosition(settings) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      settings.compareDocumentPosition(logout) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides Admin when adminMenuEnabled is false", () => {
    renderChip({
      adminSettingsChrome: {
        ...defaultAdminSettingsChrome,
        adminMenuEnabled: false,
      },
    });
    openChip();

    expect(screen.queryByRole("button", { name: "admin" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "settings" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "logout" })).toBeInTheDocument();
  });

  it("opens settings drill and navigates to an account destination", () => {
    renderChip();
    openChip();

    fireEvent.click(screen.getByRole("button", { name: "settings" }));

    expect(screen.getByRole("button", { name: "account" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "developer" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "account" }));

    expect(pushMock).toHaveBeenCalledWith("/account");
  });

  it("does not flash the credits root when navigating away from settings", () => {
    // forceMount keeps content through close (exit-animation window). If close
    // remounted the menu at root, getMoreCredits would appear — assert the
    // settings drill stays instead.
    accountSummaryPopoverTestFlags.forceMount = true;
    renderChip();
    openChip();

    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    expect(screen.getByRole("button", { name: "billing" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "getMoreCredits" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "billing" }));

    expect(
      screen.queryByRole("button", { name: "getMoreCredits" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "billing" })).toBeInTheDocument();
    expect(pushMock).toHaveBeenCalledWith("/billing");
  });

  it("starts at the root panel when reopened after closing from settings", () => {
    // forceMount keeps the settings drill mounted across close so reopen must
    // remount via menuInstance (open-only bump) to reach root again.
    accountSummaryPopoverTestFlags.forceMount = true;
    renderChip();
    openChip();

    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    expect(screen.getByRole("button", { name: "billing" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /openSummary/ }));
    openChip();

    expect(
      screen.getByRole("button", { name: "settings" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "back" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "getMoreCredits" }),
    ).toBeInTheDocument();
  });

  it("buys credits and logs out from inside the summary", () => {
    renderChip();
    openChip();

    fireEvent.click(screen.getByRole("button", { name: "getMoreCredits" }));

    expect(pushMock).toHaveBeenCalledWith("/billing?tab=credits");

    openChip();
    fireEvent.click(screen.getByRole("button", { name: "logout" }));

    // The id travels with the email so the modal can release this browser's
    // push device without subscribing to the session on every route.
    expect(showLogoutModalMock).toHaveBeenCalledWith({
      id: "user_1",
      email: "patrick@example.com",
    });
  });

  it("reports subscription usage and renewal once the period has credits", () => {
    const currentTimestampMs = 1_700_000_000_000;
    renderChip({
      creditUsage: {
        percentageUsed: 25,
        remaining: 750,
        total: 1_000,
        used: 250,
      },
      subscriptionPeriodEndMs: currentTimestampMs + 3 * 24 * 60 * 60 * 1000,
      currentTimestampMs,
    });
    openChip();

    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "75",
    );
    expect(
      screen.getByText(/creditsRemainingOfTotal 750 1000/),
    ).toBeInTheDocument();
    expect(screen.getByText(/creditsExpiresInDays 3/)).toBeInTheDocument();
  });

  it("skips the renewal line when the credits response carried no timestamp", () => {
    renderChip({
      creditUsage: {
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

  it("renders nothing on mobile (account control lives in the header)", () => {
    sidebarState.isMobile = true;
    const { container } = renderChip();

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByRole("button", { name: /openSummary/ }),
    ).not.toBeInTheDocument();
  });

  it("closes the open summary when the layout becomes mobile", () => {
    const { rerender } = renderChip();
    openChip();

    expect(screen.getByRole("button", { name: "logout" })).toBeInTheDocument();

    sidebarState.isMobile = true;
    rerender(
      <SidebarAccountChip
        sessionUser={sessionUser}
        planName="Pro"
        totalCredits={15_750}
        creditUsage={null}
        subscriptionPeriodEndMs={null}
        currentTimestampMs={1_700_000_000_000}
        lowCreditsThreshold={100}
        buyCreditsLabel="getMoreCredits"
        buyCreditsPath="/billing?tab=credits"
        adminSettingsChrome={defaultAdminSettingsChrome}
      />,
    );

    expect(screen.queryByRole("button", { name: "logout" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /openSummary/ }),
    ).not.toBeInTheDocument();

    sidebarState.isMobile = false;
    rerender(
      <SidebarAccountChip
        sessionUser={sessionUser}
        planName="Pro"
        totalCredits={15_750}
        creditUsage={null}
        subscriptionPeriodEndMs={null}
        currentTimestampMs={1_700_000_000_000}
        lowCreditsThreshold={100}
        buyCreditsLabel="getMoreCredits"
        buyCreditsPath="/billing?tab=credits"
        adminSettingsChrome={defaultAdminSettingsChrome}
      />,
    );

    expect(
      screen.getByRole("button", { name: /openSummary/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "logout" })).toBeNull();
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

  it("never shows extra-credit copy in the account overview", () => {
    renderChip({
      creditUsage: {
        percentageUsed: 25,
        remaining: 750,
        total: 1_000,
        used: 250,
      },
    });
    openChip();

    expect(screen.queryByText("extraCredits")).not.toBeInTheDocument();
    expect(
      screen.queryByText("extraCreditsDescription"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("creditsRemainingHero 750")).toBeInTheDocument();
  });
});
