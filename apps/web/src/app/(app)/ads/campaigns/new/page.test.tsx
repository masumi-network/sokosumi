import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoreApiRequestError } from "@/lib/clients/core.client";

const {
  adsServiceMock,
  formMock,
  hasSocialBetaAccessMock,
  notFoundMock,
  projectServiceMock,
} = vi.hoisted(() => ({
  adsServiceMock: {
    listAccounts: vi.fn(),
    getMarketProfile: vi.fn(),
    listMarketKeywords: vi.fn(),
    listLanguages: vi.fn(),
    getLocationById: vi.fn(),
  },
  formMock: vi.fn(),
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
vi.mock("@/app/ads/components/ads-new-campaign-form", () => ({
  GoogleSearchCampaignForm: (props: Record<string, unknown>) => {
    formMock({ ...props, form: "google" });
    return <div data-testid="form" />;
  },
  MetaCampaignForm: (props: Record<string, unknown>) => {
    formMock({ ...props, form: "meta" });
    return <div data-testid="form" />;
  },
}));

const PROJECT = { id: "project-1", name: "Launch plan" };
const GOOGLE = {
  id: "a1",
  name: "Main",
  currency: "EUR",
  provider: "google_ads",
};
const META = {
  id: "a2",
  name: "Second",
  currency: "USD",
  provider: "meta_ads",
};

async function visit(searchParams: Record<string, string | undefined>) {
  const { default: NewAdsCampaignPage } = await import("./page");
  return NewAdsCampaignPage({ searchParams: Promise.resolve(searchParams) });
}

const reached = () => formMock.mock.calls[0]?.[0];

describe("NewAdsCampaignPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasSocialBetaAccessMock.mockResolvedValue(true);
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);
    adsServiceMock.listAccounts.mockResolvedValue([GOOGLE, META]);
    adsServiceMock.getMarketProfile.mockResolvedValue({
      profile: {
        keywords: ["shoes"],
        countryCode: "DE",
        locationId: "2276",
        languageCode: "de",
      },
    });
    adsServiceMock.listLanguages.mockResolvedValue({
      languages: [
        { id: "1000", code: "en", name: "English" },
        { id: "1001", code: "de", name: "German" },
      ],
    });
    adsServiceMock.getLocationById.mockResolvedValue({
      locations: [
        {
          id: "2276",
          name: "Germany",
          canonicalName: "Germany",
          targetType: "Country",
          countryCode: "DE",
        },
      ],
    });
    adsServiceMock.listMarketKeywords.mockResolvedValue({
      keywords: [{ keyword: "running shoes" }, { keyword: "trail shoes" }],
    });
  });

  it("stays hidden outside the beta, reading nothing", async () => {
    hasSocialBetaAccessMock.mockResolvedValue(false);

    await expect(
      visit({ projectId: "project-1", accountId: "a1" }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(projectServiceMock.getProjectById).not.toHaveBeenCalled();
    expect(adsServiceMock.listAccounts).not.toHaveBeenCalled();
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
  ])("is a 404 for %s", async (_name, params) => {
    await expect(visit(params)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(adsServiceMock.listAccounts).toHaveBeenCalledWith("project-1");
    expect(formMock).not.toHaveBeenCalled();
  });

  it("renders the form for the account, with a way back to its campaigns", async () => {
    render(await visit({ projectId: "project-1", accountId: "a1" }));

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "App.Ads.newCampaign.title",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "App.Ads.newCampaign.back" }),
    ).toHaveAttribute(
      "href",
      "/ads?projectId=project-1&tab=campaigns&account=a1",
    );
    expect(reached()).toMatchObject({
      accountId: "a1",
      currency: "EUR",
      form: "google",
      projectId: "project-1",
    });
  });

  it("hands a Google account whether the project has a Market profile, reading no keywords", async () => {
    render(await visit({ projectId: "project-1", accountId: "a1" }));

    expect(reached()).toMatchObject({ form: "google", hasMarketProfile: true });
    expect(adsServiceMock.listMarketKeywords).not.toHaveBeenCalled();
  });

  it("says there is no Market profile when the project has none", async () => {
    adsServiceMock.getMarketProfile.mockResolvedValue({ profile: null });
    render(await visit({ projectId: "project-1", accountId: "a1" }));

    expect(reached()).toMatchObject({ hasMarketProfile: false });
  });

  it("still renders, without the button, when loading the profile fails", async () => {
    adsServiceMock.getMarketProfile.mockRejectedValue(
      new CoreApiRequestError("down", { status: 502 }),
    );
    render(await visit({ projectId: "project-1", accountId: "a1" }));

    expect(screen.getByTestId("form")).toBeVisible();
    expect(reached()).toMatchObject({ hasMarketProfile: false });
  });

  describe("targeting", () => {
    const targeting = () => reached().targeting;

    it("hands the form Google's languages and the Market profile's country and language", async () => {
      render(await visit({ projectId: "project-1", accountId: "a1" }));

      expect(adsServiceMock.listLanguages).toHaveBeenCalledWith(
        "project-1",
        "a1",
      );
      expect(adsServiceMock.getLocationById).toHaveBeenCalledWith(
        "project-1",
        "a1",
        "2276",
      );
      expect(targeting()).toEqual({
        languageOptions: [
          { id: "1000", name: "English" },
          { id: "1001", name: "German" },
        ],
        defaultLocations: [{ id: "2276", name: "Germany", detail: "Germany" }],
        defaultLanguages: [{ id: "1001", name: "German" }],
      });
    });

    it("looks up the location while the languages are still loading", async () => {
      let finishLanguages: (value: unknown) => void = () => undefined;
      adsServiceMock.listLanguages.mockReturnValue(
        new Promise((resolve) => {
          finishLanguages = resolve;
        }),
      );

      const page = visit({ projectId: "project-1", accountId: "a1" });

      await vi.waitFor(() =>
        expect(adsServiceMock.getLocationById).toHaveBeenCalled(),
      );
      finishLanguages({ languages: [] });
      render(await page);
      expect(targeting().defaultLocations).toHaveLength(1);
    });

    it("suggests nothing without a Market profile, looking up no location", async () => {
      adsServiceMock.getMarketProfile.mockResolvedValue({ profile: null });
      render(await visit({ projectId: "project-1", accountId: "a1" }));

      expect(adsServiceMock.getLocationById).not.toHaveBeenCalled();
      expect(targeting()).toMatchObject({
        defaultLocations: [],
        defaultLanguages: [],
      });
      expect(targeting().languageOptions).toHaveLength(2);
    });

    it("leaves the language empty when Google has none for the profile's", async () => {
      adsServiceMock.getMarketProfile.mockResolvedValue({
        profile: { countryCode: "JP", locationId: "2392", languageCode: "ja" },
      });
      render(await visit({ projectId: "project-1", accountId: "a1" }));

      expect(targeting().defaultLanguages).toEqual([]);
      expect(targeting().defaultLocations).toHaveLength(1);
    });

    it("renders without the picks that failed to load", async () => {
      adsServiceMock.listLanguages.mockRejectedValue(
        new CoreApiRequestError("down", { status: 502 }),
      );
      adsServiceMock.getLocationById.mockRejectedValue(
        new CoreApiRequestError("down", { status: 502 }),
      );
      render(await visit({ projectId: "project-1", accountId: "a1" }));

      expect(screen.getByTestId("form")).toBeVisible();
      expect(reached()).toMatchObject({ hasMarketProfile: true });
      expect(targeting()).toEqual({
        languageOptions: null,
        defaultLocations: [],
        defaultLanguages: [],
      });
    });
  });

  it("gives a Meta account the Meta form and reads no Market data", async () => {
    render(await visit({ projectId: "project-1", accountId: "a2" }));

    expect(reached()).toMatchObject({ form: "meta", currency: "USD" });
    expect(reached()).not.toHaveProperty("hasMarketProfile");
    expect(adsServiceMock.getMarketProfile).not.toHaveBeenCalled();
    expect(adsServiceMock.listMarketKeywords).not.toHaveBeenCalled();
    expect(adsServiceMock.listLanguages).not.toHaveBeenCalled();
    expect(reached()).not.toHaveProperty("targeting");
  });
});
