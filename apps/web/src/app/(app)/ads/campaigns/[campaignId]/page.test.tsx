import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoreApiRequestError } from "@/lib/clients/core.client";

const {
  adsServiceMock,
  breadcrumbMock,
  detailsMock,
  errorMock,
  hasSocialBetaAccessMock,
  notFoundMock,
  projectServiceMock,
} = vi.hoisted(() => ({
  adsServiceMock: { listAccounts: vi.fn(), getCampaignDetails: vi.fn() },
  breadcrumbMock: vi.fn(),
  detailsMock: vi.fn(),
  errorMock: vi.fn(),
  hasSocialBetaAccessMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  projectServiceMock: { getProjectById: vi.fn() },
}));

vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("next-intl/server", () => ({
  getTranslations:
    async (namespace: string) => (key: string, values?: object) =>
      `${namespace}.${key}${values ? JSON.stringify(values) : ""}`,
}));
vi.mock("@/lib/services/ads.service", () => ({ adsService: adsServiceMock }));
vi.mock("@/lib/services/project.service", () => ({
  projectService: projectServiceMock,
}));
vi.mock("@/lib/social-beta-access.server", () => ({
  hasCurrentUserSocialBetaAccess: hasSocialBetaAccessMock,
}));
vi.mock("@/app/ads/components/ads-campaign-details", () => ({
  AdsCampaignDetails: (props: Record<string, unknown>) => {
    detailsMock(props);
    return <div data-testid="details" />;
  },
}));
vi.mock("@/app/ads/components/ads-campaign-breadcrumb", () => ({
  AdsCampaignBreadcrumb: (props: Record<string, unknown>) => {
    breadcrumbMock(props);
    return null;
  },
}));
vi.mock("@/app/ads/components/ads-campaigns-error", () => ({
  AdsCampaignsError: (props: Record<string, unknown>) => {
    errorMock(props);
    return <div data-testid="not-active" />;
  },
}));
vi.mock("@/app/ads/components/ads-error-state", () => ({
  AdsErrorState: (props: { kind: string; failedTitle: string }) => (
    <div data-testid="error">{`${props.kind} ${props.failedTitle}`}</div>
  ),
}));

const PROJECT = { id: "project-1", name: "Launch plan" };
const GOOGLE = { id: "a1", name: "Main", provider: "google_ads" };
const META = { id: "a2", name: "Second", provider: "meta_ads" };
const DETAILS = { campaign: { id: "42", name: "Spring sale" } };

async function visit(
  searchParams: Record<string, string | undefined> = {
    projectId: "project-1",
    accountId: "a1",
  },
  campaignId = "42",
) {
  const { default: AdsCampaignDetailsPage } = await import("./page");
  return AdsCampaignDetailsPage({
    params: Promise.resolve({ campaignId }),
    searchParams: Promise.resolve(searchParams),
  });
}

describe("AdsCampaignDetailsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasSocialBetaAccessMock.mockResolvedValue(true);
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);
    adsServiceMock.listAccounts.mockResolvedValue([GOOGLE, META]);
    adsServiceMock.getCampaignDetails.mockResolvedValue(DETAILS);
  });

  it("stays hidden outside the beta, reading nothing", async () => {
    hasSocialBetaAccessMock.mockResolvedValue(false);

    await expect(visit()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(projectServiceMock.getProjectById).not.toHaveBeenCalled();
    expect(adsServiceMock.getCampaignDetails).not.toHaveBeenCalled();
  });

  it.each([
    ["no project", { accountId: "a1" }],
    ["an unknown project", { projectId: "gone", accountId: "a1" }],
  ])("is a 404 for %s", async (_name, params) => {
    projectServiceMock.getProjectById.mockImplementation(async (id: string) =>
      id === "project-1" ? PROJECT : null,
    );

    await expect(visit(params)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(adsServiceMock.listAccounts).not.toHaveBeenCalled();
  });

  it.each([
    ["no account", { projectId: "project-1" }],
    [
      "an account of another project",
      { projectId: "project-1", accountId: "x9" },
    ],
    ["a Meta account", { projectId: "project-1", accountId: "a2" }],
  ])("is a 404 for %s, asking Core nothing", async (_name, params) => {
    await expect(visit(params)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(adsServiceMock.getCampaignDetails).not.toHaveBeenCalled();
  });

  it.each([404, 422])("is a 404 when Core answers %i", async (status) => {
    adsServiceMock.getCampaignDetails.mockRejectedValue(
      new CoreApiRequestError("gone", { status }),
    );

    await expect(visit()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("loads the campaign over the range and renders it, with a way back that keeps the range", async () => {
    render(
      await visit({ projectId: "project-1", accountId: "a1", range: "7d" }),
    );

    expect(adsServiceMock.getCampaignDetails).toHaveBeenCalledWith(
      "project-1",
      "a1",
      "42",
      "LAST_7_DAYS",
    );
    expect(detailsMock).toHaveBeenCalledWith({
      accountId: "a1",
      details: DETAILS,
      projectId: "project-1",
      range: "7d",
    });
    expect(
      screen.getByRole("link", { name: "App.Ads.campaignDetails.back" }),
    ).toHaveAttribute(
      "href",
      "/ads?projectId=project-1&tab=campaigns&account=a1&range=7d",
    );
  });

  it("names the campaign in the breadcrumb, not its numeric id", async () => {
    render(
      await visit({ projectId: "project-1", accountId: "a1", range: "7d" }),
    );

    expect(breadcrumbMock).toHaveBeenCalledWith({
      adsHref: "/ads?projectId=project-1&tab=campaigns&account=a1&range=7d",
      campaign: {
        name: "Spring sale",
        href: "/ads/campaigns/42?projectId=project-1&accountId=a1&range=7d",
      },
    });
  });

  it("keeps the project in the breadcrumb when the campaign fails to load", async () => {
    adsServiceMock.getCampaignDetails.mockRejectedValue(
      new CoreApiRequestError("inactive", { status: 409 }),
    );
    render(await visit());

    expect(breadcrumbMock).toHaveBeenCalledWith({
      adsHref: "/ads?projectId=project-1&tab=campaigns&account=a1&range=30d",
      campaign: undefined,
    });
  });

  it("shows 30 days unless the URL says otherwise", async () => {
    render(await visit());

    expect(adsServiceMock.getCampaignDetails).toHaveBeenCalledWith(
      "project-1",
      "a1",
      "42",
      "LAST_30_DAYS",
    );
  });

  it("asks to reconnect when the connection is no longer active", async () => {
    adsServiceMock.getCampaignDetails.mockRejectedValue(
      new CoreApiRequestError("inactive", { status: 409 }),
    );
    render(await visit());

    expect(screen.getByTestId("not-active")).toBeVisible();
    expect(errorMock).toHaveBeenCalledWith({
      kind: "not_active",
      projectId: "project-1",
      provider: "google_ads",
    });
    expect(screen.getByRole("link")).toBeVisible();
    expect(screen.queryByTestId("details")).toBeNull();
  });

  it("shows the ads error for any other Core failure, keeping the way back", async () => {
    adsServiceMock.getCampaignDetails.mockRejectedValue(
      new CoreApiRequestError("down", { status: 502 }),
    );
    render(await visit());

    expect(screen.getByTestId("error")).toHaveTextContent(
      "failed App.Ads.campaignDetails.errors.failed",
    );
    expect(
      screen.getByRole("link", { name: "App.Ads.campaignDetails.back" }),
    ).toBeVisible();
  });

  it("lets a failure that is not Core's reach the error boundary", async () => {
    adsServiceMock.getCampaignDetails.mockRejectedValue(new Error("session"));

    await expect(visit()).rejects.toThrow("session");
  });
});
