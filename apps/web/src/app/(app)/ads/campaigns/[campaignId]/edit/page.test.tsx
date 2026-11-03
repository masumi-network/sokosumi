import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoreApiRequestError } from "@/lib/clients/core.client";

const {
  adsServiceMock,
  errorMock,
  modalMock,
  hasSocialBetaAccessMock,
  notFoundMock,
  projectServiceMock,
  setupMock,
} = vi.hoisted(() => ({
  adsServiceMock: { listAccounts: vi.fn(), getCampaignDetails: vi.fn() },
  errorMock: vi.fn(),
  modalMock: vi.fn(),
  hasSocialBetaAccessMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  projectServiceMock: { getProjectById: vi.fn() },
  setupMock: vi.fn(),
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
vi.mock("@/lib/ads/google-setup", () => ({
  loadGoogleSetup: setupMock,
}));
// The modal has its own tests; here it shows what the page hands it.
vi.mock("@/app/ads/components/ads-edit-campaign-modal", () => ({
  AdsEditCampaignModal: (props: { notice?: React.ReactNode }) => {
    modalMock(props);
    return <div data-testid="modal">{props.notice}</div>;
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
const GOOGLE = {
  id: "a1",
  name: "Main",
  provider: "google_ads",
  currency: "EUR",
};
const META = { id: "a2", name: "Second", provider: "meta_ads" };
const SETUP = {
  hasMarketProfile: true,
  targeting: {
    languageOptions: null,
    defaultLocations: [],
    defaultLanguages: [],
  },
};
const DETAILS = {
  campaign: {
    id: "42",
    name: "Spring sale",
    type: "SEARCH",
    dailyBudget: 25,
    startDate: null,
    endDate: null,
    started: true,
    editable: true,
    notEditableReason: null,
  },
  targeting: { locations: [], languages: [] },
  keywords: [],
  ad: null,
  sitelinks: [],
  callouts: [],
};

/** The route under test: the edit page, or the modal over the details. */
let route = "./page";

async function visit(
  searchParams: Record<string, string | undefined> = {
    projectId: "project-1",
    accountId: "a1",
    range: "7d",
  },
) {
  const { default: EditAdsCampaignPage } = await import(route);
  return EditAdsCampaignPage({
    params: Promise.resolve({ campaignId: "42" }),
    searchParams: Promise.resolve(searchParams),
  });
}

describe.each([
  ["the edit route", "./page"],
  ["the details page's modal", "../@modal/(.)edit/page"],
])("EditAdsCampaignPage from %s", (_name, path) => {
  beforeEach(() => {
    route = path;
    vi.clearAllMocks();
    hasSocialBetaAccessMock.mockResolvedValue(true);
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);
    adsServiceMock.listAccounts.mockResolvedValue([GOOGLE, META]);
    adsServiceMock.getCampaignDetails.mockResolvedValue(DETAILS);
    setupMock.mockResolvedValue(SETUP);
  });

  it("stays hidden outside the beta, reading nothing", async () => {
    hasSocialBetaAccessMock.mockResolvedValue(false);

    await expect(visit()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(projectServiceMock.getProjectById).not.toHaveBeenCalled();
  });

  it.each([
    ["no project", { accountId: "a1" }],
    ["no account", { projectId: "project-1" }],
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

  it("opens the wizard for an editable campaign, filled from the campaign", async () => {
    render(await visit());

    expect(adsServiceMock.getCampaignDetails).toHaveBeenCalledWith(
      "project-1",
      "a1",
      "42",
      "LAST_7_DAYS",
    );
    expect(setupMock).toHaveBeenCalledWith("project-1", "a1");
    expect(modalMock).toHaveBeenCalledWith({
      campaign: {
        accountId: "a1",
        accountLabel:
          'App.Ads.newCampaign.inAccount{"provider":"App.Ads.accounts.providers.google_ads","name":"Main"}',
        campaignId: "42",
        currency: "EUR",
        hasMarketProfile: true,
        projectId: "project-1",
        started: true,
        targeting: SETUP.targeting,
        initialValues: expect.objectContaining({
          type: "SEARCH",
          name: "Spring sale",
          dailyBudget: "25",
        }),
      },
    });
  });

  it("says in the modal why a campaign cannot be edited, instead of the wizard", async () => {
    adsServiceMock.getCampaignDetails.mockResolvedValue({
      ...DETAILS,
      campaign: {
        ...DETAILS.campaign,
        editable: false,
        notEditableReason: "AD_GROUPS",
      },
    });
    render(await visit());

    expect(modalMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ campaign: expect.anything() }),
    );
    expect(screen.getByTestId("modal")).toHaveTextContent(
      "App.Ads.campaignDetails.notEditable.AD_GROUPS",
    );
  });

  it("asks to reconnect when the connection is no longer active", async () => {
    adsServiceMock.getCampaignDetails.mockRejectedValue(
      new CoreApiRequestError("inactive", { status: 409 }),
    );
    render(await visit());

    expect(screen.getByTestId("modal")).toContainElement(
      screen.getByTestId("not-active"),
    );
    expect(errorMock).toHaveBeenCalledWith({
      kind: "not_active",
      projectId: "project-1",
      provider: "google_ads",
    });
    expect(modalMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ campaign: expect.anything() }),
    );
  });

  it("shows the ads error for any other Core failure", async () => {
    adsServiceMock.getCampaignDetails.mockRejectedValue(
      new CoreApiRequestError("down", { status: 502 }),
    );
    render(await visit());

    expect(
      within(screen.getByTestId("modal")).getByTestId("error"),
    ).toHaveTextContent("failed App.Ads.campaignDetails.errors.failed");
    expect(modalMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ campaign: expect.anything() }),
    );
  });
});
