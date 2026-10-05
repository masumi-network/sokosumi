import { beforeEach, describe, expect, it, vi } from "vitest";

import { ComposioApiError } from "@/clients/composio.client";
import { ComposioToolError } from "@/clients/social-post-providers/tools";

const { createSessionMock, executeToolMock, deleteSessionMock } = vi.hoisted(
  () => ({
    createSessionMock: vi.fn(),
    executeToolMock: vi.fn(),
    deleteSessionMock: vi.fn(),
  }),
);

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
  listGoogleAdAccounts,
  listGoogleCampaigns,
  updateGoogleCampaign,
} from "./google-ads";

const input = {
  connectedAccountId: "ca_google",
  executorUserId: "sokosumi:project-executor:project_1",
};

const CUSTOMER_FIELD_MASK =
  "customer.id,customer.descriptiveName,customer.currencyCode,customer.timeZone,customer.manager";

function customerResult(customerId: string): Record<string, unknown> {
  switch (customerId) {
    case "111":
      return {
        results: [
          {
            customer: {
              id: "111",
              descriptiveName: "Direct Shop",
              currencyCode: "EUR",
              timeZone: "Europe/Berlin",
            },
          },
        ],
        fieldMask: CUSTOMER_FIELD_MASK,
        requestId: "req_1",
      };
    case "222":
      // Manager account: its clients are out of reach without login-customer-id.
      return {
        results: [
          {
            customer: {
              id: "222",
              descriptiveName: "Agency",
              currencyCode: "USD",
              manager: true,
            },
          },
        ],
        fieldMask: CUSTOMER_FIELD_MASK,
      };
    case "333":
      // numeric id, no name
      return {
        results: [
          { customer: { id: 333, currencyCode: "USD", timeZone: "UTC" } },
        ],
        fieldMask: CUSTOMER_FIELD_MASK,
      };
    default:
      throw new ComposioToolError({ message: "no access" });
  }
}

describe("listGoogleAdAccounts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createSessionMock.mockResolvedValue("sess_1");
    executeToolMock.mockImplementation(
      async (call: {
        toolSlug: string;
        arguments: { customer_id?: string };
      }) =>
        call.toolSlug === "GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS"
          ? {
              resourceNames: [
                "customers/111",
                "customers/222",
                "customers/333",
                "customers/999",
              ],
            }
          : customerResult(call.arguments.customer_id ?? ""),
    );
  });

  it("lists direct customer accounts only", async () => {
    expect(await listGoogleAdAccounts(input)).toEqual([
      {
        externalAccountId: "111",
        name: "Direct Shop",
        currency: "EUR",
        timeZone: "Europe/Berlin",
      },
      {
        externalAccountId: "333",
        name: "Account 333",
        currency: "USD",
        timeZone: "UTC",
      },
    ]);
  });

  it("never queries manager client accounts", async () => {
    await listGoogleAdAccounts(input);
    const queries = executeToolMock.mock.calls.map(
      ([call]) => call.arguments.query ?? "",
    );
    expect(queries.some((query: string) => /customer_client/.test(query))).toBe(
      false,
    );
  });

  it("pins the session to the connected account and the account tools, then deletes it", async () => {
    await listGoogleAdAccounts(input);
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolkitSlug: "googleads",
        connectedAccountId: "ca_google",
        executorUserId: input.executorUserId,
        toolSlugs: [
          "GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS",
          "GOOGLEADS_SEARCH_STREAM_GAQL",
        ],
      }),
    );
    expect(deleteSessionMock).toHaveBeenCalledWith(
      "sess_1",
      expect.any(String),
    );
  });

  it("skips a customer whose query returns no rows", async () => {
    executeToolMock.mockImplementation(async (call: { toolSlug: string }) =>
      call.toolSlug === "GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS"
        ? { resourceNames: ["customers/111"] }
        : { results: [], fieldMask: CUSTOMER_FIELD_MASK },
    );
    expect(await listGoogleAdAccounts(input)).toEqual([]);
  });

  it("raises a response that does not match the expected shape", async () => {
    executeToolMock.mockImplementation(async (call: { toolSlug: string }) =>
      call.toolSlug === "GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS"
        ? { resourceNames: ["customers/111"] }
        : {
            results: [{ customer: { id: "111" } }],
            fieldMask: "customer.id",
          },
    );
    await expect(listGoogleAdAccounts(input)).rejects.toThrow(
      /invalid response/,
    );
    expect(deleteSessionMock).toHaveBeenCalled();
  });
});

describe("listGoogleCampaigns", () => {
  const campaignInput = {
    ...input,
    customerId: "111",
    range: "LAST_30_DAYS" as const,
  };

  const CAMPAIGN_FIELD_MASK = "campaign.id,campaign.name";

  const campaignRows = {
    fieldMask: CAMPAIGN_FIELD_MASK,
    requestId: "req_1",
    results: [
      {
        campaign: {
          id: "1",
          name: "Brand search",
          status: "ENABLED",
          advertisingChannelType: "SEARCH",
          servingStatus: "SERVING",
        },
        campaignBudget: { amountMicros: "12500000" },
      },
      {
        // numeric id, nothing spent in the range
        campaign: {
          id: 2,
          name: "Paused promo",
          status: "PAUSED",
          advertisingChannelType: "DISPLAY",
        },
        campaignBudget: { amountMicros: 5000000 },
      },
      {
        campaign: {
          id: "3",
          name: "Old sale",
          status: "ENABLED",
          advertisingChannelType: "SEARCH",
          servingStatus: "ENDED",
        },
      },
      {
        campaign: { id: "4", name: "Draft", status: "UNKNOWN" },
      },
    ],
  };

  const metricRows = {
    fieldMask: "campaign.id,metrics.costMicros",
    requestId: "req_2",
    results: [
      {
        campaign: { id: "1" },
        metrics: {
          costMicros: "20000000",
          impressions: "1000",
          clicks: "40",
          conversions: 3.5,
        },
      },
      {
        campaign: { id: "3" },
        metrics: {
          costMicros: "0",
          impressions: "500",
          clicks: "0",
          conversions: 0,
        },
      },
    ],
  };

  function mockQueries(campaigns: unknown, metrics: unknown) {
    executeToolMock.mockImplementation(
      async (call: { arguments: { query: string } }) =>
        /metrics\./.test(call.arguments.query) ? metrics : campaigns,
    );
  }

  beforeEach(() => {
    vi.resetAllMocks();
    createSessionMock.mockResolvedValue("sess_1");
    mockQueries(campaignRows, metricRows);
  });

  it("merges campaigns with metrics, computing ctr and cpc", async () => {
    expect(await listGoogleCampaigns(campaignInput)).toEqual([
      {
        id: "1",
        name: "Brand search",
        status: "ACTIVE",
        objective: "SEARCH",
        dailyBudget: 12.5,
        spend: 20,
        impressions: 1000,
        clicks: 40,
        ctr: 0.04,
        cpc: 0.5,
        conversions: 3.5,
      },
      {
        id: "2",
        name: "Paused promo",
        status: "PAUSED",
        objective: "DISPLAY",
        dailyBudget: 5,
        spend: 0,
        impressions: 0,
        clicks: 0,
        ctr: null,
        cpc: null,
        conversions: 0,
      },
      {
        // Zero clicks: cpc is null, not Infinity. Serving status ENDED: ENDED.
        id: "3",
        name: "Old sale",
        status: "ENDED",
        objective: "SEARCH",
        dailyBudget: null,
        spend: 0,
        impressions: 500,
        clicks: 0,
        ctr: 0,
        cpc: null,
        conversions: 0,
      },
      {
        id: "4",
        name: "Draft",
        status: "OTHER",
        objective: null,
        dailyBudget: null,
        spend: 0,
        impressions: 0,
        clicks: 0,
        ctr: null,
        cpc: null,
        conversions: 0,
      },
    ]);
  });

  it("returns an empty list for an account without campaigns", async () => {
    const empty = { results: [], fieldMask: CAMPAIGN_FIELD_MASK };
    mockQueries(empty, empty);
    expect(await listGoogleCampaigns(campaignInput)).toEqual([]);
  });

  it("raises a payload without a results list instead of returning nothing", async () => {
    mockQueries({ unexpected: true }, metricRows);
    await expect(listGoogleCampaigns(campaignInput)).rejects.toBeInstanceOf(
      ComposioApiError,
    );
    mockQueries(null, metricRows);
    await expect(listGoogleCampaigns(campaignInput)).rejects.toBeInstanceOf(
      ComposioApiError,
    );
  });

  it("queries the customer, excludes removed campaigns and bounds metrics by the range", async () => {
    await listGoogleCampaigns({ ...campaignInput, range: "LAST_7_DAYS" });
    const calls = executeToolMock.mock.calls.map(([call]) => call);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.toolSlug).toBe("GOOGLEADS_SEARCH_STREAM_GAQL");
      expect(call.arguments.customer_id).toBe("111");
      expect(call.arguments.query).toContain("campaign.status != 'REMOVED'");
    }
    const [campaignsCall] = calls.filter(
      (call) => !call.arguments.query.includes("metrics."),
    );
    expect(campaignsCall.arguments.query).toContain("campaign.serving_status");
    expect(campaignsCall.arguments.query).toContain("LIMIT 1000");
    expect(campaignsCall.arguments.query).not.toContain("end_date");
    expect(
      calls.filter((call) =>
        call.arguments.query.includes("segments.date DURING LAST_7_DAYS"),
      ),
    ).toHaveLength(1);
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolkitSlug: "googleads",
        connectedAccountId: "ca_google",
        toolSlugs: ["GOOGLEADS_SEARCH_STREAM_GAQL"],
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
    await expect(listGoogleCampaigns(campaignInput)).rejects.toBeInstanceOf(
      ComposioToolError,
    );
    expect(deleteSessionMock).toHaveBeenCalled();
  });

  it("raises a row that does not match the expected shape", async () => {
    mockQueries(
      {
        results: [{ campaign: { name: "no id" } }],
        fieldMask: CAMPAIGN_FIELD_MASK,
      },
      metricRows,
    );
    await expect(listGoogleCampaigns(campaignInput)).rejects.toThrow(
      /invalid response/,
    );
  });
});

describe("updateGoogleCampaign", () => {
  const update = {
    ...input,
    customerId: "111",
    campaignId: "42",
  };
  const lookup = (overrides: Record<string, unknown> = {}) => ({
    results: [
      {
        campaign: {
          id: "42",
          campaignBudget: "customers/111/campaignBudgets/7",
        },
        campaignBudget: { explicitlyShared: false },
        ...overrides,
      },
    ],
    fieldMask:
      "campaign.id,campaign.campaignBudget,campaignBudget.explicitlyShared",
    requestId: "req_1",
  });
  const mutated = {
    results: [{ resource_name: "customers/111/campaigns/42" }],
    successful_count: 1,
  };
  const writes = () =>
    executeToolMock.mock.calls
      .map(([call]) => call)
      .filter((call) => call.toolSlug !== "GOOGLEADS_SEARCH_STREAM_GAQL");

  beforeEach(() => {
    vi.resetAllMocks();
    createSessionMock.mockResolvedValue("sess_1");
    executeToolMock.mockImplementation(async (call: { toolSlug: string }) =>
      call.toolSlug === "GOOGLEADS_SEARCH_STREAM_GAQL" ? lookup() : mutated,
    );
  });

  it("looks the campaign up in the customer before writing", async () => {
    await updateGoogleCampaign({ ...update, status: "PAUSED" });
    const [first] = executeToolMock.mock.calls[0] ?? [];
    expect(first).toMatchObject({
      toolSlug: "GOOGLEADS_SEARCH_STREAM_GAQL",
      arguments: { customer_id: "111" },
    });
    expect(first.arguments.query).toMatch(/campaign\.id = 42 AND/);
  });

  it.each([
    ["PAUSED", "paused"],
    ["ACTIVE", "enabled"],
  ] as const)(
    "sets status %s as %s in an update operation",
    async (status, google) => {
      await updateGoogleCampaign({ ...update, status });
      expect(writes()).toEqual([
        expect.objectContaining({
          toolSlug: "GOOGLEADS_MUTATE_CAMPAIGNS",
          arguments: {
            customer_id: "111",
            operations: [
              {
                operation_type: "update",
                update: {
                  resource_name: "customers/111/campaigns/42",
                  status: google,
                },
              },
            ],
          },
        }),
      ]);
    },
  );

  it("sends budget operations without an operation_type, in micros", async () => {
    await updateGoogleCampaign({ ...update, dailyBudget: 12.34 });
    expect(writes()).toEqual([
      expect.objectContaining({
        toolSlug: "GOOGLEADS_MUTATE_CAMPAIGN_BUDGETS",
        arguments: {
          customer_id: "111",
          operations: [
            {
              update: {
                resource_name: "customers/111/campaignBudgets/7",
                amount_micros: 12340000,
              },
              update_mask: "amount_micros",
            },
          ],
        },
      }),
    ]);
  });

  it("changes the budget first, then the status", async () => {
    await updateGoogleCampaign({
      ...update,
      status: "ACTIVE",
      dailyBudget: 20,
    });
    expect(writes().map((call) => call.toolSlug)).toEqual([
      "GOOGLEADS_MUTATE_CAMPAIGN_BUDGETS",
      "GOOGLEADS_MUTATE_CAMPAIGNS",
    ]);
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolSlugs: [
          "GOOGLEADS_SEARCH_STREAM_GAQL",
          "GOOGLEADS_MUTATE_CAMPAIGNS",
          "GOOGLEADS_MUTATE_CAMPAIGN_BUDGETS",
        ],
      }),
    );
  });

  it("returns 404 without writing when the campaign is not in the customer", async () => {
    executeToolMock.mockResolvedValue({
      results: [],
      fieldMask: "campaign.id",
    });
    await expect(
      updateGoogleCampaign({ ...update, status: "PAUSED" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(executeToolMock).toHaveBeenCalledTimes(1);
    expect(deleteSessionMock).toHaveBeenCalled();
  });

  it("returns 409 without any write for a shared budget", async () => {
    executeToolMock.mockResolvedValue(
      lookup({
        campaignBudget: { explicitlyShared: true, amountMicros: "1" },
      }),
    );
    await expect(
      updateGoogleCampaign({ ...update, status: "PAUSED", dailyBudget: 9 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(writes()).toEqual([]);
  });

  it("still changes status when the budget is shared and not requested", async () => {
    executeToolMock.mockImplementation(async (call: { toolSlug: string }) =>
      call.toolSlug === "GOOGLEADS_SEARCH_STREAM_GAQL"
        ? lookup({ campaignBudget: { explicitlyShared: true } })
        : mutated,
    );
    await updateGoogleCampaign({ ...update, status: "PAUSED" });
    expect(writes()).toHaveLength(1);
  });

  it("raises a provider error and still deletes the session", async () => {
    executeToolMock.mockImplementation(async (call: { toolSlug: string }) => {
      if (call.toolSlug === "GOOGLEADS_SEARCH_STREAM_GAQL") return lookup();
      throw new ComposioToolError({ message: "refused" });
    });
    await expect(
      updateGoogleCampaign({ ...update, status: "PAUSED" }),
    ).rejects.toBeInstanceOf(ComposioToolError);
    expect(deleteSessionMock).toHaveBeenCalled();
  });

  it.each([
    ["no results", { results: [] }],
    ["no payload", {}],
    ["a partial failure", { results: [], partial_failure_error: { code: 3 } }],
  ])(
    "raises a tool error when the mutation returns %s",
    async (_name, result) => {
      executeToolMock.mockImplementation(async (call: { toolSlug: string }) =>
        call.toolSlug === "GOOGLEADS_SEARCH_STREAM_GAQL" ? lookup() : result,
      );
      await expect(
        updateGoogleCampaign({ ...update, dailyBudget: 5 }),
      ).rejects.toBeInstanceOf(ComposioToolError);
      await expect(
        updateGoogleCampaign({ ...update, status: "PAUSED" }),
      ).rejects.toBeInstanceOf(ComposioToolError);
    },
  );
});
