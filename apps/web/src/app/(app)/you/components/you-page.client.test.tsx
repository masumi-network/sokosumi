import type { SessionUser } from "@sokosumi/utils";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/hooks/use-self-presence", () => ({
  useSelfPresence: () => "online",
}));

vi.mock("@/components/analytics/cookie-banner", () => ({
  openConsentPreferences: vi.fn(),
}));

import { YouPageClient } from "@/app/you/components/you-page.client";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";

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

function renderYouPage(
  overrides: Partial<React.ComponentProps<typeof YouPageClient>> = {},
) {
  return render(
    <YouPageClient
      sessionUser={sessionUser}
      calendarMenuEnabled={false}
      planName="Pro"
      totalCredits={15_750}
      extraCredits={750}
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

describe("YouPageClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders identity with status and plan under the email", () => {
    renderYouPage();

    const shell = screen.getByTestId("you-page");
    expect(shell).toBeInTheDocument();
    expect(shell.className).toContain("md:max-w-4xl");
    expect(shell.className).not.toContain("px-4");
    expect(shell.className).not.toContain("max-w-lg");
    expect(
      screen.getByRole("heading", { name: "Patrick Tobler" }),
    ).toBeInTheDocument();
    expect(screen.getByText("patrick@example.com")).toBeInTheDocument();
    expect(screen.queryByTestId("you-workspace-switch")).toBeNull();

    const statusPlan = screen.getByTestId("you-status-plan");
    expect(statusPlan).toBeInTheDocument();
    expect(statusPlan.className).toBe("flex items-center gap-2");
    expect(statusPlan).toHaveTextContent("online");
    expect(statusPlan).toHaveTextContent("Pro");
    expect(
      screen
        .getByText("patrick@example.com")
        .compareDocumentPosition(statusPlan) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText(/balanceCreditsLabel 15750/)).toBeInTheDocument();
  });

  it("shows a large avatar with initials", () => {
    renderYouPage();

    expect(screen.getByText("PT")).toBeInTheDocument();
  });

  it("navigates to buy credits from the affordance", () => {
    renderYouPage();

    fireEvent.click(screen.getByTestId("you-buy-credits"));

    expect(pushMock).toHaveBeenCalledWith("/billing?tab=credits");
  });

  it("groups Schedules and Files in the first nav section", () => {
    renderYouPage({ calendarMenuEnabled: true });

    const schedules = screen.getByTestId("you-schedules");
    const files = screen.getByTestId("you-files");

    expect(schedules).toHaveAttribute("href", "/calendar");
    expect(files).toHaveAttribute("href", "/drive");
    expect(
      schedules.compareDocumentPosition(files) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides Schedules when calendar menu is disabled", () => {
    renderYouPage({ calendarMenuEnabled: false });

    expect(screen.queryByTestId("you-schedules")).toBeNull();
    expect(screen.getByTestId("you-files")).toHaveAttribute("href", "/drive");
  });

  it("shows Admin alone before account links when admin is enabled", () => {
    renderYouPage();

    const admin = screen.getByTestId("you-admin");
    const account = screen.getByTestId("you-account");
    const logout = screen.getByTestId("you-logout");

    expect(admin).toHaveAttribute("href", "/admin");
    expect(account).toHaveAttribute("href", "/account");
    expect(screen.queryByTestId("you-settings")).toBeNull();
    expect(
      admin.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      account.compareDocumentPosition(logout) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("flattens account and drill triggers onto the root menu", () => {
    renderYouPage();

    expect(screen.queryByTestId("you-settings")).toBeNull();
    expect(screen.getByTestId("you-account")).toHaveAttribute(
      "href",
      "/account",
    );
    expect(screen.getByTestId("you-billing")).toHaveAttribute(
      "href",
      "/billing",
    );
    expect(screen.getByTestId("you-connections")).toHaveAttribute(
      "href",
      "/connections",
    );
    expect(screen.getByTestId("you-developer")).toBeInTheDocument();
    expect(screen.getByTestId("you-help")).toBeInTheDocument();
    expect(screen.getByTestId("you-legal")).toBeInTheDocument();
    expect(screen.getByTestId("you-buy-credits")).toBeInTheDocument();
    expect(screen.getByTestId("you-logout")).toBeInTheDocument();
  });

  it("navigates to an account destination from the flattened account link", () => {
    renderYouPage();

    fireEvent.click(screen.getByTestId("you-account"));

    expect(screen.getByTestId("you-account")).toHaveAttribute(
      "href",
      "/account",
    );
  });

  it("opens Developer, Help, and Legal as stacked routes under You", () => {
    renderYouPage();

    expect(screen.getByTestId("you-developer")).toHaveAttribute(
      "href",
      "/you/developer",
    );
    expect(screen.getByTestId("you-help")).toHaveAttribute("href", "/you/help");
    expect(screen.getByTestId("you-legal")).toHaveAttribute(
      "href",
      "/you/legal",
    );
    expect(screen.queryByTestId("you-drill-section")).toBeNull();
    expect(screen.queryByTestId("you-drill-back")).toBeNull();
    expect(screen.getByTestId("you-buy-credits")).toBeInTheDocument();
    expect(screen.getByTestId("you-logout")).toBeInTheDocument();
    expect(screen.getByTestId("you-files")).toBeInTheDocument();
  });

  it("hides Admin when adminMenuEnabled is false", () => {
    renderYouPage({
      adminSettingsChrome: {
        ...defaultAdminSettingsChrome,
        adminMenuEnabled: false,
      },
    });

    expect(screen.queryByTestId("you-admin")).toBeNull();
    expect(screen.queryByTestId("you-settings")).toBeNull();
    expect(screen.getByTestId("you-account")).toBeInTheDocument();
    expect(screen.getByTestId("you-logout")).toBeInTheDocument();
  });

  it("uses a plain link style and the logout confirmation flow", () => {
    renderYouPage();

    const logout = screen.getByTestId("you-logout");
    expect(logout.className).not.toContain("bg-destructive");
    expect(logout.className).toContain("px-0");
    expect(logout.className).toContain("justify-center");

    fireEvent.click(logout);

    expect(showLogoutModalMock).toHaveBeenCalledWith({
      id: "user_1",
      email: "patrick@example.com",
    });
  });
});
