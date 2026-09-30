import { beforeEach, describe, expect, it, vi } from "vitest";

import { ComposioApiError } from "@/clients/composio.client";
import { ComposioToolError } from "@/clients/social-post-providers/tools";

const { createSessionMock, executeToolMock, deleteSessionMock, warnMock } =
  vi.hoisted(() => ({
    createSessionMock: vi.fn(),
    executeToolMock: vi.fn(),
    deleteSessionMock: vi.fn(),
    warnMock: vi.fn(),
  }));

vi.mock("@/lib/evlog", () => ({ tryUseLogger: () => ({ warn: warnMock }) }));

vi.mock("@/clients/composio.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/composio.client")>()),
  deleteComposioToolSession: deleteSessionMock,
}));
vi.mock("@/clients/social-post-providers/tools", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/clients/social-post-providers/tools")
  >()),
  createComposioToolSession: createSessionMock,
  executeComposioTool: executeToolMock,
}));

import {
  listMetaAdAccounts,
  listMetaCampaigns,
  updateMetaCampaign,
} from "./meta-ads";

const input = {
  connectedAccountId: "ca_meta",
  executorUserId: "sokosumi:project-executor:project_1",
};

describe("listMetaAdAccounts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createSessionMock.mockResolvedValue("sess_1");
  });

  it("maps ad accounts from the data list", async () => {
    executeToolMock.mockResolvedValue({
      data: [
        {
          id: "act_1",
          name: "Brand",
          currency: "EUR",
          timezone_name: "Europe/Berlin",
        },
        { id: "2", currency: "USD" },
      ],
    });
    expect(await listMetaAdAccounts(input)).toEqual([
      {
        externalAccountId: "act_1",
        name: "Brand",
        currency: "EUR",
        timeZone: "Europe/Berlin",
      },
      {
        externalAccountId: "act_2",
        name: "act_2",
        currency: "USD",
        timeZone: null,
      },
    ]);
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolkitSlug: "metaads",
        connectedAccountId: "ca_meta",
        toolSlugs: ["METAADS_GET_AD_ACCOUNTS"],
      }),
    );
    expect(deleteSessionMock).toHaveBeenCalledWith(
      "sess_1",
      expect.any(String),
    );
  });

  it("returns nothing when the user has no ad accounts", async () => {
    executeToolMock.mockResolvedValue({ data: [] });
    expect(await listMetaAdAccounts(input)).toEqual([]);
  });

  it("raises an account without a currency", async () => {
    executeToolMock.mockResolvedValue({ data: [{ id: "act_1" }] });
    await expect(listMetaAdAccounts(input)).rejects.toThrow(/invalid response/);
  });
});

describe("listMetaCampaigns", () => {
  const campaignInput = {
    ...input,
    adAccountId: "act_1",
    currency: "EUR",
    range: "LAST_7_DAYS" as const,
  };

  const campaignList = {
    data: [
      {
        id: "10",
        name: "Reach",
        status: "ACTIVE",
        effective_status: "ACTIVE",
        objective: "OUTCOME_AWARENESS",
        daily_budget: "2550",
      },
      {
        // No insights row: it spent nothing in the range.
        id: "11",
        name: "Paused",
        status: "PAUSED",
        effective_status: "CAMPAIGN_PAUSED",
        objective: "OUTCOME_TRAFFIC",
      },
      {
        id: "12",
        name: "Done",
        status: "ACTIVE",
        effective_status: "COMPLETED",
        objective: "OUTCOME_SALES",
        daily_budget: "1000",
      },
      {
        id: "14",
        name: "Odd",
        status: "ACTIVE",
        effective_status: "IN_PROCESS",
      },
    ],
  };

  const insights = {
    data: [
      { campaign_id: "10", spend: "12.345", impressions: "2000", clicks: "50" },
      { campaign_id: "12", spend: "3.00", impressions: "100", clicks: "0" },
    ],
  };

  function mockTools(list: unknown, rows: unknown) {
    executeToolMock.mockImplementation(async (call: { toolSlug: string }) =>
      call.toolSlug === "METAADS_LIST_CAMPAIGNS" ? list : rows,
    );
  }

  beforeEach(() => {
    vi.resetAllMocks();
    createSessionMock.mockResolvedValue("sess_1");
    mockTools(campaignList, insights);
  });

  it("merges campaigns with insights and maps the effective status", async () => {
    expect(await listMetaCampaigns(campaignInput)).toEqual([
      {
        id: "10",
        name: "Reach",
        status: "ACTIVE",
        objective: "OUTCOME_AWARENESS",
        dailyBudget: 25.5,
        spend: 12.35,
        impressions: 2000,
        clicks: 50,
        ctr: 0.025,
        cpc: 0.25,
        conversions: null,
      },
      {
        id: "11",
        name: "Paused",
        status: "PAUSED",
        objective: "OUTCOME_TRAFFIC",
        dailyBudget: null,
        spend: 0,
        impressions: 0,
        clicks: 0,
        ctr: null,
        cpc: null,
        conversions: null,
      },
      {
        // Zero clicks: cpc is null, not Infinity.
        id: "12",
        name: "Done",
        status: "OTHER",
        objective: "OUTCOME_SALES",
        dailyBudget: 10,
        spend: 3,
        impressions: 100,
        clicks: 0,
        ctr: 0,
        cpc: null,
        conversions: null,
      },
      {
        id: "14",
        name: "Odd",
        status: "OTHER",
        objective: null,
        dailyBudget: null,
        spend: 0,
        impressions: 0,
        clicks: 0,
        ctr: null,
        cpc: null,
        conversions: null,
      },
    ]);
  });

  it("returns an empty list for an account without campaigns", async () => {
    mockTools({ data: [] }, { data: [] });
    expect(await listMetaCampaigns(campaignInput)).toEqual([]);
  });

  it("asks for campaigns with a field array", async () => {
    await listMetaCampaigns(campaignInput);
    expect(executeToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolSlug: "METAADS_LIST_CAMPAIGNS",
        arguments: expect.objectContaining({
          ad_account_id: "act_1",
          fields: [
            "id",
            "name",
            "status",
            "effective_status",
            "objective",
            "daily_budget",
          ],
        }),
      }),
    );
  });

  it("asks for campaign-level insights over the range and pins the two tools", async () => {
    await listMetaCampaigns({ ...campaignInput, range: "LAST_30_DAYS" });
    expect(executeToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolSlug: "METAADS_GET_INSIGHTS",
        arguments: expect.objectContaining({
          object_id: "act_1",
          level: "campaign",
          fields: ["campaign_id", "spend", "impressions", "clicks"],
          date_preset: "last_30d",
        }),
      }),
    );
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolkitSlug: "metaads",
        connectedAccountId: "ca_meta",
        toolSlugs: ["METAADS_LIST_CAMPAIGNS", "METAADS_GET_INSIGHTS"],
      }),
    );
    expect(deleteSessionMock).toHaveBeenCalledWith(
      "sess_1",
      expect.any(String),
    );
  });

  it("raises a Composio tool error and still deletes the session", async () => {
    executeToolMock.mockRejectedValue(
      new ComposioToolError({ message: "refused" }),
    );
    await expect(listMetaCampaigns(campaignInput)).rejects.toBeInstanceOf(
      ComposioToolError,
    );
    expect(deleteSessionMock).toHaveBeenCalled();
  });

  it("converts the budget with the currency's minor units", async () => {
    mockTools(
      { data: [{ id: "10", name: "Yen", daily_budget: "5000" }] },
      { data: [] },
    );
    const [campaign] = await listMetaCampaigns({
      ...campaignInput,
      currency: "JPY",
    });
    expect(campaign?.dailyBudget).toBe(5000);
  });

  it.each([null, {}, { unexpected: true }])(
    "raises a payload without a data list (%j) instead of returning nothing",
    async (payload) => {
      mockTools(payload, insights);
      await expect(listMetaCampaigns(campaignInput)).rejects.toBeInstanceOf(
        ComposioApiError,
      );
    },
  );

  it("follows paging cursors for campaigns and insights and merges the pages", async () => {
    executeToolMock.mockImplementation(
      async (call: { toolSlug: string; arguments: { after?: string } }) => {
        const isList = call.toolSlug === "METAADS_LIST_CAMPAIGNS";
        if (!call.arguments.after) {
          return {
            data: isList
              ? [{ id: "10", name: "One", status: "ACTIVE" }]
              : [
                  {
                    campaign_id: "10",
                    spend: "1",
                    impressions: "10",
                    clicks: "1",
                  },
                ],
            paging: { cursors: { after: "page2" } },
          };
        }
        // Last page, without a further cursor.
        return {
          data: isList
            ? [{ id: "11", name: "Two", status: "PAUSED" }]
            : [
                {
                  campaign_id: "11",
                  spend: "2",
                  impressions: "20",
                  clicks: "2",
                },
              ],
          paging: { cursors: { before: "page1" } },
        };
      },
    );
    const campaigns = await listMetaCampaigns(campaignInput);
    expect(campaigns.map((c) => [c.id, c.spend])).toEqual([
      ["10", 1],
      ["11", 2],
    ]);
    expect(executeToolMock).toHaveBeenCalledTimes(4);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("stops at ten pages per tool, logs, and returns what it has", async () => {
    executeToolMock.mockImplementation(async (call: { toolSlug: string }) => ({
      data:
        call.toolSlug === "METAADS_LIST_CAMPAIGNS"
          ? [{ id: "10", name: "One", status: "ACTIVE" }]
          : [{ campaign_id: "10", spend: "1", impressions: "10", clicks: "1" }],
      paging: { cursors: { after: "more" } },
    }));
    const campaigns = await listMetaCampaigns(campaignInput);
    expect(executeToolMock).toHaveBeenCalledTimes(20);
    expect(campaigns).toHaveLength(10);
    expect(warnMock).toHaveBeenCalled();
  });

  it("raises a row that does not match the expected shape", async () => {
    mockTools({ data: [{ name: "no id" }] }, insights);
    await expect(listMetaCampaigns(campaignInput)).rejects.toThrow(
      /invalid response/,
    );
  });
});

describe("updateMetaCampaign", () => {
  const update = {
    ...input,
    adAccountId: "act_1",
    campaignId: "10",
  };
  const campaignObject = (overrides: Record<string, unknown> = {}) => ({
    id: "10",
    account_id: "1",
    daily_budget: "2550",
    ...overrides,
  });
  const writes = () =>
    executeToolMock.mock.calls
      .map(([call]) => call)
      .filter((call) => call.toolSlug === "METAADS_UPDATE_CAMPAIGN");

  beforeEach(() => {
    vi.resetAllMocks();
    createSessionMock.mockResolvedValue("sess_1");
    executeToolMock.mockImplementation(async (call: { toolSlug: string }) =>
      call.toolSlug === "METAADS_GET_OBJECT" ? campaignObject() : {},
    );
  });

  it("reads the campaign's account before writing", async () => {
    await updateMetaCampaign({ ...update, status: "PAUSED" });
    expect(executeToolMock.mock.calls[0]?.[0]).toMatchObject({
      toolSlug: "METAADS_GET_OBJECT",
      arguments: {
        object_id: "10",
        fields: ["id", "account_id", "daily_budget"],
      },
    });
  });

  it("sets the status", async () => {
    await updateMetaCampaign({ ...update, status: "ACTIVE" });
    expect(writes().map((call) => call.arguments)).toEqual([
      { campaign_id: "10", status: "ACTIVE" },
    ]);
  });

  it("sets the budget as a decimal in the account currency", async () => {
    await updateMetaCampaign({ ...update, dailyBudget: 12.34 });
    expect(writes().map((call) => call.arguments)).toEqual([
      { campaign_id: "10", daily_budget: 12.34 },
    ]);
  });

  it("changes the budget first, then the status, in separate calls", async () => {
    await updateMetaCampaign({ ...update, status: "PAUSED", dailyBudget: 20 });
    expect(writes().map((call) => call.arguments)).toEqual([
      { campaign_id: "10", daily_budget: 20 },
      { campaign_id: "10", status: "PAUSED" },
    ]);
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolkitSlug: "metaads",
        toolSlugs: ["METAADS_GET_OBJECT", "METAADS_UPDATE_CAMPAIGN"],
      }),
    );
  });

  it("accepts a campaign nested under data and an account id with the act_ prefix", async () => {
    executeToolMock.mockImplementation(async (call: { toolSlug: string }) =>
      call.toolSlug === "METAADS_GET_OBJECT"
        ? { data: campaignObject({ account_id: "act_1" }) }
        : {},
    );
    await updateMetaCampaign({ ...update, status: "PAUSED" });
    expect(writes()).toHaveLength(1);
  });

  it("returns 404 without writing for a campaign of another ad account", async () => {
    executeToolMock.mockResolvedValue(campaignObject({ account_id: "2" }));
    await expect(
      updateMetaCampaign({ ...update, status: "PAUSED" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(writes()).toEqual([]);
    expect(deleteSessionMock).toHaveBeenCalled();
  });

  it("raises a campaign without an account id instead of writing", async () => {
    executeToolMock.mockResolvedValue({ id: "10" });
    await expect(
      updateMetaCampaign({ ...update, status: "PAUSED" }),
    ).rejects.toThrow(/invalid response/);
    expect(writes()).toEqual([]);
  });

  it.each([{ daily_budget: null }, { daily_budget: undefined }])(
    "returns 409 without any write when the budget is on the ad sets (%j)",
    async (overrides) => {
      executeToolMock.mockResolvedValue(campaignObject(overrides));
      await expect(
        updateMetaCampaign({ ...update, status: "PAUSED", dailyBudget: 9 }),
      ).rejects.toMatchObject({ status: 409 });
      expect(writes()).toEqual([]);
    },
  );

  it("still changes status for a campaign whose budget is on its ad sets", async () => {
    executeToolMock.mockResolvedValue(campaignObject({ daily_budget: null }));
    await updateMetaCampaign({ ...update, status: "PAUSED" });
    expect(writes()).toHaveLength(1);
  });

  it("raises a provider error and still deletes the session", async () => {
    executeToolMock.mockImplementation(async (call: { toolSlug: string }) => {
      if (call.toolSlug === "METAADS_GET_OBJECT") return campaignObject();
      throw new ComposioToolError({ message: "refused" });
    });
    await expect(
      updateMetaCampaign({ ...update, status: "PAUSED" }),
    ).rejects.toBeInstanceOf(ComposioToolError);
    expect(deleteSessionMock).toHaveBeenCalled();
  });
});
