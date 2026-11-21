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

vi.mock("@/hooks/effects/use-self-presence", () => ({
  useSelfPresence: () => "online",
}));

let scopeProjectId: string | null = null;

vi.mock("@/app/components/project-scope/use-project-scope", async () => {
  const { scopedHref } = await import(
    "@/app/components/project-scope/project-scope-href"
  );
  return {
    useProjectScope: () => ({
      hrefFor: (href: string) => scopedHref(href, scopeProjectId),
    }),
  };
});

vi.mock("@/components/analytics/cookie-banner", () => ({
  openConsentPreferences: vi.fn(),
}));

import type { MemberWithOrganization } from "@sokosumi/core-client";
import { YouPageClient } from "@/app/you/components/you-page.client";

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
      planName="Pro"
      totalCredits={15_750}
      extraCredits={15_750}
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
    // Fills the width like every app page (DESIGN.md, Fill the width).
    expect(shell.className).not.toContain("max-w-");
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
    expect(screen.queryByText(/balanceCreditsLabel/)).not.toBeInTheDocument();
    expect(screen.getByTestId("credits-additional")).toHaveTextContent(
      "additionalCreditsHero 15750",
    );
    expect(screen.queryByText("monthlyUsageLimit")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
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

  it("links Credit History right after the buy credits button", () => {
    renderYouPage();

    const history = screen.getByTestId("you-history");

    expect(history).toHaveAttribute("href", "/history?from=you");
    expect(
      screen.getByTestId("you-buy-credits").compareDocumentPosition(history) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("links public Social next to Content Studio", () => {
    renderYouPage();

    const social = screen.getByTestId("you-social");
    expect(social).toHaveAttribute("href", "/social?from=you");
    expect(
      screen.getByTestId("you-studio").compareDocumentPosition(social) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows Social by default", () => {
    renderYouPage();

    expect(screen.getByTestId("you-social")).toBeInTheDocument();
  });

  it("links Ads after Social", () => {
    renderYouPage();

    const ads = screen.getByTestId("you-ads");
    expect(ads).toHaveAttribute("href", "/ads");
    expect(
      screen.getByTestId("you-social").compareDocumentPosition(ads) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      ads.compareDocumentPosition(screen.getByTestId("you-files")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("links SEO between Social and Ads, as the sidebar does", () => {
    renderYouPage();

    const seo = screen.getByTestId("you-seo");
    expect(seo).toHaveAttribute("href", "/seo");
    expect(
      screen.getByTestId("you-social").compareDocumentPosition(seo) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      seo.compareDocumentPosition(screen.getByTestId("you-ads")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows Ads by default", () => {
    renderYouPage();

    expect(screen.getByTestId("you-ads")).toBeInTheDocument();
  });

  it("links Newsletter between Ads and Files when available", () => {
    renderYouPage({ newsletterEnabled: true });

    const newsletter = screen.getByTestId("you-newsletter");
    expect(newsletter).toHaveAttribute("href", "/newsletter");
    expect(
      screen.getByTestId("you-ads").compareDocumentPosition(newsletter) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      newsletter.compareDocumentPosition(screen.getByTestId("you-files")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("leaves Newsletter out until workspace availability is resolved", () => {
    renderYouPage();

    expect(screen.queryByTestId("you-newsletter")).not.toBeInTheDocument();
  });

  it("shows Newsletter alongside Ads when available", () => {
    renderYouPage({ newsletterEnabled: true });

    expect(screen.getByTestId("you-newsletter")).toHaveAttribute(
      "href",
      "/newsletter",
    );
    expect(screen.getByTestId("you-ads")).toBeInTheDocument();
  });

  it("groups Schedules, Studio and Files in the destinations section", () => {
    renderYouPage();

    const schedules = screen.getByTestId("you-schedules");
    const studio = screen.getByTestId("you-studio");
    const files = screen.getByTestId("you-files");

    expect(schedules).toHaveAttribute("href", "/schedules?from=you");
    expect(studio).toHaveAttribute("href", "/studio?from=you");
    expect(files).toHaveAttribute("href", "/drive?from=you");
    expect(
      schedules.compareDocumentPosition(studio) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      studio.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("puts Content Studio after Schedules and before Files", () => {
    renderYouPage();

    const schedules = screen.getByTestId("you-schedules");
    const studio = screen.getByTestId("you-studio");
    const files = screen.getByTestId("you-files");

    expect(studio).toHaveAttribute("href", "/studio?from=you");
    expect(studio).toHaveTextContent("contentStudio");
    expect(
      schedules.compareDocumentPosition(studio) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      studio.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("lists Schedules", () => {
    renderYouPage();

    expect(screen.getByTestId("you-schedules")).toHaveAttribute(
      "href",
      "/schedules?from=you",
    );
  });

  it("lists Calendar after Schedules", () => {
    renderYouPage();

    const schedules = screen.getByTestId("you-schedules");
    const calendar = screen.getByTestId("you-calendar");

    expect(calendar).toHaveAttribute("href", "/calendar?from=you");
    expect(
      schedules.compareDocumentPosition(calendar) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // Phones have no sidebar: every sidebar destination needs a row here.
  it("lists the sidebar's Agents, TikTok Studio and Contacts in sidebar order", () => {
    renderYouPage();

    const agents = screen.getByTestId("you-agents");
    const schedules = screen.getByTestId("you-schedules");
    const studio = screen.getByTestId("you-studio");
    const tiktok = screen.getByTestId("you-tiktok-studio");
    const social = screen.getByTestId("you-social");
    const contacts = screen.getByTestId("you-contacts");
    const files = screen.getByTestId("you-files");

    expect(agents).toHaveAttribute("href", "/agents?from=you");
    expect(tiktok).toHaveAttribute("href", "/tiktok-studio?from=you");
    expect(contacts).toHaveAttribute("href", "/contacts?from=you");
    for (const [before, after] of [
      [agents, schedules],
      [studio, tiktok],
      [tiktok, social],
      [contacts, files],
    ]) {
      expect(
        before.compareDocumentPosition(after) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("keeps the selected project on the TikTok Studio row, like the sidebar", () => {
    scopeProjectId = "p-1";
    try {
      renderYouPage();
      expect(screen.getByTestId("you-tiktok-studio")).toHaveAttribute(
        "href",
        "/tiktok-studio?projectId=p-1&from=you",
      );
    } finally {
      scopeProjectId = null;
    }
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

  // The marker rides on the link, so a new tab from a modified click gets it
  // and the visit it opens keeps it through reload, Back and Forward.
  it("marks destination rows as opened from You, not settings rows", () => {
    renderYouPage();

    expect(screen.getByTestId("you-contacts")).toHaveAttribute(
      "href",
      "/contacts?from=you",
    );
    expect(screen.getByTestId("you-account")).toHaveAttribute(
      "href",
      "/account",
    );
    expect(screen.getByTestId("you-seo")).toHaveAttribute("href", "/seo");
  });

  // The header bell is the inbox, also called Notifications.
  it("names the notification settings row apart from the inbox", () => {
    renderYouPage();

    const row = screen.getByTestId("you-notifications");
    expect(row).toHaveAttribute("href", "/account/notifications");
    expect(row).toHaveTextContent("notificationSettings");
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

  it("shows additional credits plus plan-cycle remaining on You and never extra-row copy", () => {
    renderYouPage({
      extraCredits: 51_162,
      creditUsage: {
        percentageUsed: 25,
        remaining: 750,
        total: 1_000,
        used: 250,
      },
    });

    expect(screen.getByTestId("credits-cycle-overview")).toBeInTheDocument();
    const monthlyHeading = screen.getByText("monthlyUsageLimit");
    const additional = screen.getByTestId("credits-additional");
    expect(
      monthlyHeading.compareDocumentPosition(additional) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(additional).toHaveTextContent("additionalCreditsHero 51162");
    expect(screen.getByText("additionalCreditsLabel")).toBeInTheDocument();
    expect(screen.getByText("creditsRemainingHero 750")).toBeInTheDocument();
    expect(screen.queryByText("extraCredits")).not.toBeInTheDocument();
    expect(screen.queryByText("totalBalanceLabel")).not.toBeInTheDocument();
    expect(screen.queryByText("totalAvailableLabel")).not.toBeInTheDocument();
  });
});
