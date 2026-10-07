import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const coreClientMock = {
  deleteProjectsByIdAdsAccountsByAccountId: vi.fn(),
  deleteProjectsByIdAdsConnectionsByAdConnectionId: vi.fn(),
  getProjectsByIdAdsAccounts: vi.fn(),
  getProjectsByIdAdsAccountsByAccountIdCampaigns: vi.fn(),
  patchProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId: vi.fn(),
  postProjectsByIdAdsAccounts: vi.fn(),
  postProjectsByIdAdsAccountsByAccountIdCampaigns: vi.fn(),
  postProjectsByIdAdsConnectionsFinalize: vi.fn(),
  postProjectsByIdAdsConnectionsInitiate: vi.fn(),
};

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: coreClientMock,
}));

const ACCOUNT = {
  id: "account-1",
  connectionId: "connection-1",
  provider: "google_ads" as const,
  externalAccountId: "123-456-7890",
  name: "Launch plan",
  currency: "EUR",
  timeZone: null,
  loginCustomerId: null,
  createdAt: new Date("2026-10-01T10:00:00.000Z"),
};

describe("adsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists a project's ad accounts", async () => {
    coreClientMock.getProjectsByIdAdsAccounts.mockResolvedValue({
      data: [ACCOUNT],
    });

    const { adsService } = await import("./ads.service");

    await expect(adsService.listAccounts("project-1")).resolves.toEqual([
      ACCOUNT,
    ]);
    expect(coreClientMock.getProjectsByIdAdsAccounts).toHaveBeenCalledWith(
      "project-1",
    );
  });

  it("initiates a connection for a provider", async () => {
    const initiation = {
      connectionId: "ca_1",
      redirectUrl: "https://connect.composio.dev/link",
    };
    coreClientMock.postProjectsByIdAdsConnectionsInitiate.mockResolvedValue({
      data: initiation,
    });

    const { adsService } = await import("./ads.service");

    await expect(
      adsService.initiateConnection("project-1", "meta_ads"),
    ).resolves.toEqual(initiation);
    expect(
      coreClientMock.postProjectsByIdAdsConnectionsInitiate,
    ).toHaveBeenCalledWith("project-1", { provider: "meta_ads" });
  });

  it("finalizes a connection and returns what it can reach", async () => {
    const finalization = {
      connection: {
        id: "connection-1",
        provider: "google_ads",
        status: "active",
        createdAt: new Date("2026-10-01T10:00:00.000Z"),
      },
      availableAccounts: [],
    };
    coreClientMock.postProjectsByIdAdsConnectionsFinalize.mockResolvedValue({
      data: finalization,
    });

    const { adsService } = await import("./ads.service");

    await expect(
      adsService.finalizeConnection("project-1", "ca_1"),
    ).resolves.toEqual(finalization);
    expect(
      coreClientMock.postProjectsByIdAdsConnectionsFinalize,
    ).toHaveBeenCalledWith("project-1", { connectionId: "ca_1" });
  });

  it("attaches the chosen accounts", async () => {
    coreClientMock.postProjectsByIdAdsAccounts.mockResolvedValue({
      data: [ACCOUNT],
    });

    const { adsService } = await import("./ads.service");

    await expect(
      adsService.attachAccounts("project-1", "connection-1", ["123-456-7890"]),
    ).resolves.toEqual([ACCOUNT]);
    expect(coreClientMock.postProjectsByIdAdsAccounts).toHaveBeenCalledWith(
      "project-1",
      { adConnectionId: "connection-1", externalAccountIds: ["123-456-7890"] },
    );
  });

  it("disconnects an account, which answers with no content", async () => {
    coreClientMock.deleteProjectsByIdAdsAccountsByAccountId.mockResolvedValue(
      undefined,
    );

    const { adsService } = await import("./ads.service");

    await expect(
      adsService.disconnectAccount("project-1", "account-1"),
    ).resolves.toBeUndefined();
    expect(
      coreClientMock.deleteProjectsByIdAdsAccountsByAccountId,
    ).toHaveBeenCalledWith({ id: "project-1", accountId: "account-1" });
  });

  it("discards a connection that holds no accounts", async () => {
    coreClientMock.deleteProjectsByIdAdsConnectionsByAdConnectionId.mockResolvedValue(
      undefined,
    );

    const { adsService } = await import("./ads.service");

    await expect(
      adsService.discardConnection("project-1", "connection-1"),
    ).resolves.toBeUndefined();
    expect(
      coreClientMock.deleteProjectsByIdAdsConnectionsByAdConnectionId,
    ).toHaveBeenCalledWith({ id: "project-1", adConnectionId: "connection-1" });
  });

  it("lets Core errors through", async () => {
    coreClientMock.getProjectsByIdAdsAccounts.mockRejectedValue(
      new Error("boom"),
    );

    const { adsService } = await import("./ads.service");

    await expect(adsService.listAccounts("project-1")).rejects.toThrow("boom");
  });

  it("lists an account's campaigns over a range", async () => {
    const body = { campaigns: [], range: "LAST_7_DAYS", currency: "EUR" };
    coreClientMock.getProjectsByIdAdsAccountsByAccountIdCampaigns.mockResolvedValue(
      { data: body },
    );

    const { adsService } = await import("./ads.service");

    await expect(
      adsService.listCampaigns("project-1", "account-1", "LAST_7_DAYS"),
    ).resolves.toEqual(body);
    expect(
      coreClientMock.getProjectsByIdAdsAccountsByAccountIdCampaigns,
    ).toHaveBeenCalledWith(
      { id: "project-1", accountId: "account-1" },
      { range: "LAST_7_DAYS" },
    );
  });

  it("updates a campaign's status or budget", async () => {
    coreClientMock.patchProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId.mockResolvedValue(
      undefined,
    );

    const { adsService } = await import("./ads.service");

    await adsService.updateCampaign("project-1", "account-1", "42", {
      status: "PAUSED",
    });
    expect(
      coreClientMock.patchProjectsByIdAdsAccountsByAccountIdCampaignsByCampaignId,
    ).toHaveBeenCalledWith(
      { id: "project-1", accountId: "account-1", campaignId: "42" },
      { status: "PAUSED" },
    );
  });

  it("creates a campaign and returns its id", async () => {
    coreClientMock.postProjectsByIdAdsAccountsByAccountIdCampaigns.mockResolvedValue(
      { data: { id: "42" } },
    );

    const { adsService } = await import("./ads.service");

    await expect(
      adsService.createCampaign("project-1", "account-1", {
        name: "Spring sale",
        dailyBudget: 25,
      }),
    ).resolves.toEqual({ id: "42" });
    expect(
      coreClientMock.postProjectsByIdAdsAccountsByAccountIdCampaigns,
    ).toHaveBeenCalledWith(
      { id: "project-1", accountId: "account-1" },
      { name: "Spring sale", dailyBudget: 25 },
    );
  });
});
