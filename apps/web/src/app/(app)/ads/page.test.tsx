import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { hasSocialBetaAccessMock, notFoundMock, projectServiceMock } =
  vi.hoisted(() => ({
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
  AdsTabs: () => <div data-testid="ads-tabs" />,
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
  });

  it("stays hidden outside the beta, reading nothing", async () => {
    hasSocialBetaAccessMock.mockResolvedValue(false);
    const { default: AdsPage } = await import("./page");

    await expect(
      AdsPage({ searchParams: Promise.resolve({ projectId: "project-1" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
    expect(projectServiceMock.getProjectById).not.toHaveBeenCalled();
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

  it("opens the scoped project's tabs under the page title and project name", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);

    await visit({ projectId: "project-1" });

    expect(projectServiceMock.getProjectById).toHaveBeenCalledWith("project-1");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "App.Ads.title",
    );
    expect(screen.getByText("Launch plan")).toBeInTheDocument();
    expect(screen.getByTestId("ads-tabs")).toBeInTheDocument();
  });

  it("names the page in the document title", async () => {
    const { generateMetadata } = await import("./page");

    await expect(generateMetadata()).resolves.toEqual({
      title: "App.Ads.title",
    });
  });
});
