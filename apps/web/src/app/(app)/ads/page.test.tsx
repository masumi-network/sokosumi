import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  adsServiceMock,
  hasSocialBetaAccessMock,
  notFoundMock,
  projectServiceMock,
} = vi.hoisted(() => ({
  adsServiceMock: { listAccounts: vi.fn() },
  hasSocialBetaAccessMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  projectServiceMock: { getProjectById: vi.fn() },
}));

vi.mock("next/server", () => ({ connection: async () => undefined }));

vi.mock("next/navigation", () => ({ notFound: notFoundMock }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

vi.mock("@/lib/services/ads.service", () => ({
  adsService: adsServiceMock,
}));

vi.mock("@/lib/services/project.service", () => ({
  projectService: projectServiceMock,
}));

vi.mock("@/lib/social-beta-access.server", () => ({
  hasCurrentUserSocialBetaAccess: hasSocialBetaAccessMock,
}));

// The picker reaches for the sidebar switcher's list, and the tabs read the
// URL through nuqs. This file is about which state the page chooses.
vi.mock("@/app/components/project-scope/project-scope-picker", () => ({
  ProjectScopePicker: ({ body, testId }: { body: string; testId: string }) => (
    <div data-testid={testId}>{body}</div>
  ),
}));

vi.mock("./components/ads-tabs", () => ({
  AdsTabs: ({
    accounts,
    campaigns,
    market,
    projectId,
  }: {
    accounts: { id: string }[];
    campaigns: React.ReactNode;
    market: React.ReactNode;
    projectId: string;
  }) => (
    <div data-testid="ads-tabs">
      {projectId}:{accounts.map(({ id }) => id).join(",")}
      {campaigns}
      {market}
    </div>
  ),
}));

vi.mock("./components/ads-campaigns-toolbar", () => ({
  AdsCampaignsToolbar: ({
    account,
    range,
  }: {
    account: { id: string };
    range: string;
  }) => <div data-testid="ads-toolbar">{`${account.id}/${range}`}</div>,
}));

vi.mock("./components/ads-campaigns-section", () => ({
  AdsCampaignsSection: ({
    account,
    range,
  }: {
    account: { id: string };
    range: string;
  }) => <div data-testid="ads-section">{`${account.id}/${range}`}</div>,
}));

vi.mock("./components/ads-market-section", () => ({
  AdsMarketSection: ({ projectId }: { projectId: string }) => (
    <div data-testid="ads-market">{projectId}</div>
  ),
}));

vi.mock("./components/ads-skeleton", () => ({
  AdsRowsSkeleton: () => <div>rows skeleton</div>,
}));

const PROJECT = { id: "project-1", name: "Launch plan" };

async function visit(searchParams: Record<string, string | undefined> = {}) {
  const { default: AdsPage } = await import("./page");
  render(await AdsPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("AdsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasSocialBetaAccessMock.mockResolvedValue(true);
    adsServiceMock.listAccounts.mockResolvedValue([]);
  });

  it("stays hidden outside the beta, reading nothing", async () => {
    hasSocialBetaAccessMock.mockResolvedValue(false);
    const { default: AdsPage } = await import("./page");

    await expect(
      AdsPage({ searchParams: Promise.resolve({ projectId: "project-1" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
    expect(projectServiceMock.getProjectById).not.toHaveBeenCalled();
    expect(adsServiceMock.listAccounts).not.toHaveBeenCalled();
  });

  it("asks which project to work in when no scope is set", async () => {
    await visit();

    expect(screen.getByTestId("ads-no-project")).toHaveTextContent(
      "App.Ads.pickBody",
    );
    expect(screen.queryByTestId("ads-tabs")).not.toBeInTheDocument();
    expect(projectServiceMock.getProjectById).not.toHaveBeenCalled();
  });

  it("treats a blank projectId as no scope rather than as a project", async () => {
    await visit({ projectId: " " });

    expect(screen.getByTestId("ads-no-project")).toBeInTheDocument();
    expect(projectServiceMock.getProjectById).not.toHaveBeenCalled();
  });

  it("offers another project instead of 404ing on a scope this workspace lost", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(null);

    await visit({ projectId: "project-gone" });

    expect(screen.getByTestId("ads-no-project")).toHaveTextContent(
      "App.Ads.pickUnavailable",
    );
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("opens the scoped project's tabs under a hidden page heading", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);

    await visit({ projectId: "project-1" });

    expect(projectServiceMock.getProjectById).toHaveBeenCalledWith("project-1");
    const [heading] = screen.getAllByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("App.Ads.title");
    expect(heading).toHaveClass("sr-only");
    expect(screen.queryByText("Launch plan")).not.toBeInTheDocument();
    expect(screen.getByTestId("ads-tabs")).toBeInTheDocument();
  });

  it("hands the tabs the project's ad accounts", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);
    adsServiceMock.listAccounts.mockResolvedValue([{ id: "account-1" }]);

    await visit({ projectId: "project-1" });

    expect(adsServiceMock.listAccounts).toHaveBeenCalledWith("project-1");
    expect(screen.getByTestId("ads-tabs")).toHaveTextContent(
      "project-1:account-1",
    );
  });

  describe("campaigns", () => {
    const accounts = [{ id: "account-1" }, { id: "account-2" }];

    beforeEach(() => {
      projectServiceMock.getProjectById.mockResolvedValue(PROJECT);
      adsServiceMock.listAccounts.mockResolvedValue(accounts);
    });

    it("loads the first account over 30 days by default", async () => {
      await visit({ projectId: "project-1" });

      expect(screen.getByTestId("ads-toolbar")).toHaveTextContent(
        "account-1/30d",
      );
      expect(screen.getByTestId("ads-section")).toHaveTextContent(
        "account-1/30d",
      );
    });

    it("loads the account and range the URL names", async () => {
      await visit({
        projectId: "project-1",
        account: "account-2",
        range: "7d",
      });

      expect(screen.getByTestId("ads-section")).toHaveTextContent(
        "account-2/7d",
      );
    });

    it("falls back for an unknown account and range", async () => {
      await visit({ projectId: "project-1", account: "gone", range: "1y" });

      expect(screen.getByTestId("ads-section")).toHaveTextContent(
        "account-1/30d",
      );
    });

    it.each(["accounts", "market"])(
      "does not load campaigns on the %s tab",
      async (tab) => {
        await visit({ projectId: "project-1", tab });

        expect(screen.queryByTestId("ads-section")).not.toBeInTheDocument();
      },
    );

    it("does not load campaigns without accounts", async () => {
      adsServiceMock.listAccounts.mockResolvedValue([]);

      await visit({ projectId: "project-1" });

      expect(screen.queryByTestId("ads-section")).not.toBeInTheDocument();
    });
  });

  describe("market", () => {
    beforeEach(() => {
      projectServiceMock.getProjectById.mockResolvedValue(PROJECT);
    });

    it("loads the project's market on the Market tab, with or without accounts", async () => {
      await visit({ projectId: "project-1", tab: "market" });

      expect(screen.getByTestId("ads-market")).toHaveTextContent("project-1");
      expect(screen.queryByTestId("ads-section")).not.toBeInTheDocument();
    });

    it.each(["campaigns", "accounts"])(
      "does not load the market on the %s tab",
      async (tab) => {
        await visit({ projectId: "project-1", tab });

        expect(screen.queryByTestId("ads-market")).not.toBeInTheDocument();
      },
    );
  });

  it("names the page in the document title", async () => {
    const { generateMetadata } = await import("./page");

    await expect(generateMetadata()).resolves.toEqual({
      title: "App.Ads.title",
    });
  });
});
