import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  hasBeta,
  mayApprove,
  approved,
  files,
  accounts,
  campaigns,
  createCampaign,
  updateCampaign,
  attach,
  finalize,
  complete,
  fileUpdate,
  adConnectionFind,
  adAccountCount,
} = vi.hoisted(() => ({
  hasBeta: vi.fn(),
  mayApprove: vi.fn(),
  approved: vi.fn(),
  files: vi.fn(),
  accounts: vi.fn(),
  campaigns: vi.fn(),
  createCampaign: vi.fn(),
  updateCampaign: vi.fn(),
  attach: vi.fn(),
  finalize: vi.fn(),
  complete: vi.fn(),
  fileUpdate: vi.fn(),
  adConnectionFind: vi.fn(),
  adAccountCount: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    marketingStrategyFile: { update: fileUpdate },
    projectAdConnection: { findUnique: adConnectionFind },
    projectAdAccount: { count: adAccountCount },
  },
}));
vi.mock("@/helpers/social-beta-access", () => ({
  hasSocialBetaAccess: hasBeta,
}));
vi.mock("@/services/cmo-cuso.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/cmo-cuso.service")>()),
  requireCuso: vi.fn(async () => ({
    sokoBotId: "bot-1",
    projectId: "project-1",
    workspaceId: "ws-1",
  })),
  cmoPayer: vi.fn(async () => ({ organizationId: "org-1" })),
}));
vi.mock("@/services/composio-callback-completion.service", () => ({
  completeComposioCallback: complete,
}));
vi.mock("@/services/marketing-strategy.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/marketing-strategy.service")
  >()),
  approvedMarketingStrategy: approved,
  listMarketingStrategyFiles: files,
  mayApproveMarketingStrategy: mayApprove,
  parseMarketingPlan: (plan: unknown) => plan,
}));
vi.mock("@/services/project-ad-accounts.service", () => ({
  attachProjectAdAccounts: attach,
  createProjectAdCampaign: createCampaign,
  finalizeProjectAdConnection: finalize,
  initiateProjectAdConnection: vi.fn(),
  listProjectAdAccounts: accounts,
  listProjectAdCampaigns: campaigns,
  listProjectAdConnectionChoices: vi.fn(),
  listProjectAdLanguages: vi.fn(async () => ({
    languages: [{ id: "1001", code: "de", name: "German" }],
  })),
  searchProjectAdLocations: vi.fn(async () => ({
    locations: [{ id: "2276", name: "Germany" }],
  })),
  updateProjectAdCampaign: updateCampaign,
}));

import {
  finalizeCmoAds,
  launchCmoSearchAd,
  setCmoAdCampaignStatus,
} from "./cmo-ads.service";
import { CmoConflictError, CmoForbiddenError } from "./cmo-cuso.service";

const searchAd = {
  keywords: ["fixed wireless internet"],
  headlines: ["Fast internet", "No cable needed", "Check your address"],
  descriptions: ["Internet over the air.", "Check your address in a minute."],
  finalUrl: "https://rst.de/check",
  location: "Germany",
  language: "de",
};

const plan = {
  month: "2026-11",
  summary: "Plan",
  goals: [],
  pillars: [],
  channels: [],
  calendar: [
    {
      id: "ad-1",
      date: "2026-11-05",
      channel: "google_ads",
      title: "Address check ad",
      format: "search",
      status: "draft",
    },
  ],
  ads: {
    monthly: 300,
    currency: "EUR",
    expect: "Orders",
    without: "Organic",
  },
};

const google = {
  id: "account-1",
  name: "RST",
  provider: "google_ads",
  currency: "EUR",
};

beforeEach(() => {
  vi.clearAllMocks();
  hasBeta.mockResolvedValue(true);
  mayApprove.mockResolvedValue(true);
  approved.mockResolvedValue({ id: "version-1", plan });
  files.mockResolvedValue(
    new Map([
      ["ad-1", { fileId: "file-1", media: [], searchAd, adCampaign: null }],
    ]),
  );
  accounts.mockResolvedValue([google]);
  campaigns.mockResolvedValue({ campaigns: [] });
  createCampaign.mockResolvedValue({ id: "campaign-1" });
});

describe("launching a search ad", () => {
  it("builds the Google campaign from Cuso's parts, keeps it, then starts it", async () => {
    await launchCmoSearchAd({ userId: "user-1", entryId: "ad-1" });

    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "account-1",
        name: "Address check ad (CMO)",
        dailyBudget: 10,
        google: expect.objectContaining({
          type: "SEARCH",
          locationIds: ["2276"],
          languageIds: ["1001"],
          finalUrl: "https://rst.de/check",
          keywords: [{ text: "fixed wireless internet", matchType: "PHRASE" }],
        }),
      }),
    );
    expect(fileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { adAccountId: "account-1", adCampaignId: "campaign-1" },
      }),
    );
    expect(updateCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "campaign-1", status: "ACTIVE" }),
    );
  });

  it("refuses past the plan's daily ad budget and spends nothing", async () => {
    campaigns.mockResolvedValue({
      campaigns: [{ id: "other", status: "ACTIVE", dailyBudget: 5 }],
    });
    await expect(
      launchCmoSearchAd({ userId: "user-1", entryId: "ad-1" }),
    ).rejects.toThrow(/plan allows EUR 10.00/);
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it("refuses an ad account that bills in another currency", async () => {
    accounts.mockResolvedValue([{ ...google, currency: "USD" }]);
    await expect(
      launchCmoSearchAd({ userId: "user-1", entryId: "ad-1" }),
    ).rejects.toBeInstanceOf(CmoConflictError);
  });

  it("is only for owners and admins in the Ads beta", async () => {
    hasBeta.mockResolvedValueOnce(false);
    await expect(
      launchCmoSearchAd({ userId: "user-1", entryId: "ad-1" }),
    ).rejects.toBeInstanceOf(CmoForbiddenError);
    mayApprove.mockResolvedValueOnce(false);
    await expect(
      launchCmoSearchAd({ userId: "user-1", entryId: "ad-1" }),
    ).rejects.toBeInstanceOf(CmoForbiddenError);
  });
});

describe("starting a paused campaign", () => {
  it("counts its own budget once, not twice", async () => {
    campaigns.mockResolvedValue({
      campaigns: [{ id: "campaign-1", status: "ACTIVE", dailyBudget: 10 }],
    });
    await setCmoAdCampaignStatus({
      userId: "user-1",
      accountId: "account-1",
      campaignId: "campaign-1",
      status: "ACTIVE",
    });
    expect(updateCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ACTIVE" }),
    );
  });

  it("pauses without checking the budget", async () => {
    approved.mockResolvedValue(null);
    await setCmoAdCampaignStatus({
      userId: "user-1",
      accountId: "account-1",
      campaignId: "campaign-1",
      status: "PAUSED",
    });
    expect(updateCampaign).toHaveBeenCalled();
  });
});

describe("finishing an ad connection", () => {
  it("redeems the callback and attaches the only ad account", async () => {
    adConnectionFind.mockResolvedValue(null);
    finalize.mockResolvedValue({
      connection: { id: "connection-1" },
      availableAccounts: [{ externalAccountId: "123", name: "RST" }],
    });
    adAccountCount.mockResolvedValue(0);
    await expect(
      finalizeCmoAds({
        userId: "user-1",
        connectionId: "ca_1",
        sessionUri: "https://composio/session",
      }),
    ).resolves.toEqual({ state: "connected" });
    expect(complete).toHaveBeenCalled();
    expect(attach).toHaveBeenCalledWith(
      expect.objectContaining({ externalAccountIds: ["123"] }),
    );
  });

  it("asks the owner to choose among several", async () => {
    adConnectionFind.mockResolvedValue({ id: "connection-1" });
    finalize.mockResolvedValue({
      connection: { id: "connection-1" },
      availableAccounts: [
        { externalAccountId: "1", name: "A" },
        { externalAccountId: "2", name: "B" },
      ],
    });
    adAccountCount.mockResolvedValue(0);
    const result = await finalizeCmoAds({
      userId: "user-1",
      connectionId: "ca_1",
      sessionUri: null,
    });
    expect(result.state).toBe("choose");
    expect(complete).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });
});
