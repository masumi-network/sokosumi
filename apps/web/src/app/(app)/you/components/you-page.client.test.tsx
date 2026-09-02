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

  it("groups Admin and Settings before Log out when admin is enabled", () => {
    renderYouPage();

    const admin = screen.getByTestId("you-admin");
    const settings = screen.getByTestId("you-settings");
    const logout = screen.getByTestId("you-logout");

    expect(admin).toHaveAttribute("href", "/admin");
    expect(settings).not.toHaveAttribute("href");
    expect(
      admin.compareDocumentPosition(settings) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      settings.compareDocumentPosition(logout) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opens an in-page settings drill instead of navigating to /account", () => {
    renderYouPage();

    fireEvent.click(screen.getByTestId("you-settings"));

    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("you-settings-panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "account" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "developer" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "help" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "legal" })).toBeInTheDocument();
    expect(screen.queryByTestId("you-logout")).toBeNull();
    expect(screen.queryByTestId("you-buy-credits")).toBeNull();
  });

  it("navigates to an account destination from the settings drill", () => {
    renderYouPage();

    fireEvent.click(screen.getByTestId("you-settings"));
    fireEvent.click(screen.getByRole("button", { name: "account" }));

    expect(pushMock).toHaveBeenCalledWith("/account");
  });

  it("returns to the You root from the settings drill back control", () => {
    renderYouPage();

    fireEvent.click(screen.getByTestId("you-settings"));
    expect(screen.getByTestId("you-settings-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "back" }));

    expect(screen.queryByTestId("you-settings-panel")).toBeNull();
    expect(screen.getByTestId("you-settings")).toBeInTheDocument();
    expect(screen.getByTestId("you-logout")).toBeInTheDocument();
  });

  it("drills into nested settings panels on the You page", () => {
    renderYouPage();

    fireEvent.click(screen.getByTestId("you-settings"));
    fireEvent.click(screen.getByRole("button", { name: "help" }));

    expect(
      screen.getByRole("button", { name: "documentation" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "support" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "back" }));

    expect(screen.getByRole("button", { name: "account" })).toBeInTheDocument();
  });

  it("hides Admin when adminMenuEnabled is false", () => {
    renderYouPage({
      adminSettingsChrome: {
        ...defaultAdminSettingsChrome,
        adminMenuEnabled: false,
      },
    });

    expect(screen.queryByTestId("you-admin")).toBeNull();
    expect(screen.getByTestId("you-settings")).toBeInTheDocument();
    expect(screen.getByTestId("you-logout")).toBeInTheDocument();
  });

  it("uses a plain link style and the logout confirmation flow", () => {
    renderYouPage();

    const logout = screen.getByTestId("you-logout");
    expect(logout.className).not.toContain("bg-destructive");
    expect(logout.className).toContain("px-0");

    fireEvent.click(logout);

    expect(showLogoutModalMock).toHaveBeenCalledWith({
      id: "user_1",
      email: "patrick@example.com",
    });
  });
});
