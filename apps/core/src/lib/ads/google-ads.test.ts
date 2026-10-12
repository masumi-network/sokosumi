import { beforeEach, describe, expect, it, vi } from "vitest";

import { ComposioApiError } from "@/clients/composio.client";
import { ComposioToolError } from "@/clients/social-post-providers/tools";

const {
  createSessionMock,
  executeToolMock,
  deleteSessionMock,
  proxyFetchMock,
} = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  executeToolMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  proxyFetchMock: vi.fn(),
}));

vi.mock("@/clients/composio.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/composio.client")>()),
  deleteComposioToolSession: deleteSessionMock,
  projectComposioFetch: proxyFetchMock,
}));
vi.mock("@/clients/social-post-providers/tools", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/clients/social-post-providers/tools")
  >()),
  createComposioToolSession: createSessionMock,
  executeComposioTool: executeToolMock,
}));

import {
  createGoogleCampaign,
  listGoogleAdAccounts,
  listGoogleCampaigns,
  listGoogleLanguages,
  searchGoogleLocations,
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

describe("createGoogleCampaign", () => {
  const google = {
    type: "SEARCH" as const,
    locationIds: ["2276", "2840"],
    languageIds: ["1001"],
    finalUrl: "https://example.com/spring",
    keywords: [
      { text: "running shoes", matchType: "BROAD" as const },
      { text: "Running Shoes", matchType: "BROAD" as const },
      { text: "running shoes", matchType: "EXACT" as const },
    ],
    headlines: ["Run faster", "Light shoes", "Free returns"],
    descriptions: ["Shoes for every runner.", "Order today."],
  };
  const create = {
    ...input,
    customerId: "111",
    name: "Spring sale",
    dailyBudget: 12.34,
    google,
  };
  const batchResult = {
    mutate_operation_responses: [
      {
        campaign_budget_result: {
          resource_name: "customers/111/campaignBudgets/7",
        },
      },
      { campaign_result: { resource_name: "customers/111/campaigns/42" } },
      { ad_group_result: { resource_name: "customers/111/adGroups/9" } },
    ],
  };
  const calls = () => executeToolMock.mock.calls.map(([call]) => call);
  const operations = () =>
    calls()[0]?.arguments.mutate_operations as Record<
      string,
      Record<string, Record<string, unknown>>
    >[];
  const operationsOf = (key: string) =>
    operations()
      .filter((operation) => key in operation)
      .map((operation) => operation[key]?.create);

  beforeEach(() => {
    vi.resetAllMocks();
    createSessionMock.mockResolvedValue("sess_1");
    executeToolMock.mockResolvedValue(batchResult);
  });

  it("creates the whole tree in one atomic BATCH_MUTATE call and returns the campaign id", async () => {
    await expect(createGoogleCampaign(create)).resolves.toBe("42");
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatchObject({
      toolSlug: "GOOGLEADS_BATCH_MUTATE",
      arguments: { customer_id: "111", partial_failure: false },
    });
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolkitSlug: "googleads",
        toolSlugs: ["GOOGLEADS_BATCH_MUTATE"],
      }),
    );
    expect(deleteSessionMock).toHaveBeenCalled();
  });

  it("sends one operation family per item, linked by temporary ids", async () => {
    await createGoogleCampaign(create);
    const ops = operations();
    for (const operation of ops) expect(Object.keys(operation)).toHaveLength(1);
    expect(ops.map((operation) => Object.keys(operation)[0])).toEqual([
      "campaign_budget_operation",
      "campaign_operation",
      "campaign_criterion_operation",
      "campaign_criterion_operation",
      "campaign_criterion_operation",
      "ad_group_operation",
      "ad_group_criterion_operation",
      "ad_group_criterion_operation",
      "ad_group_ad_operation",
    ]);
    expect(ops[0]).toEqual({
      campaign_budget_operation: {
        create: {
          resource_name: "customers/111/campaignBudgets/-1",
          name: expect.stringMatching(/^Spring sale budget [0-9a-f]{8}$/),
          amount_micros: 12340000,
          delivery_method: "STANDARD",
          explicitly_shared: false,
        },
      },
    });
    expect(ops[1]).toEqual({
      campaign_operation: {
        create: {
          resource_name: "customers/111/campaigns/-2",
          name: "Spring sale",
          status: "PAUSED",
          advertising_channel_type: "SEARCH",
          campaign_budget: "customers/111/campaignBudgets/-1",
          target_spend: {},
          network_settings: {
            target_google_search: true,
            target_search_network: false,
            target_content_network: false,
          },
          contains_eu_political_advertising:
            "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
        },
      },
    });
    expect(operationsOf("campaign_criterion_operation")).toEqual([
      {
        campaign: "customers/111/campaigns/-2",
        location: { geo_target_constant: "geoTargetConstants/2276" },
      },
      {
        campaign: "customers/111/campaigns/-2",
        location: { geo_target_constant: "geoTargetConstants/2840" },
      },
      {
        campaign: "customers/111/campaigns/-2",
        language: { language_constant: "languageConstants/1001" },
      },
    ]);
    expect(operationsOf("ad_group_operation")).toEqual([
      {
        resource_name: "customers/111/adGroups/-3",
        campaign: "customers/111/campaigns/-2",
        name: "Ad group 1",
        status: "ENABLED",
        type: "SEARCH_STANDARD",
      },
    ]);
    expect(operationsOf("ad_group_criterion_operation")).toEqual([
      {
        ad_group: "customers/111/adGroups/-3",
        status: "ENABLED",
        keyword: { text: "running shoes", match_type: "BROAD" },
      },
      {
        ad_group: "customers/111/adGroups/-3",
        status: "ENABLED",
        keyword: { text: "running shoes", match_type: "EXACT" },
      },
    ]);
    expect(operationsOf("ad_group_ad_operation")).toEqual([
      {
        ad_group: "customers/111/adGroups/-3",
        status: "ENABLED",
        ad: {
          final_urls: ["https://example.com/spring"],
          responsive_search_ad: {
            headlines: [
              { text: "Run faster" },
              { text: "Light shoes" },
              { text: "Free returns" },
            ],
            descriptions: [
              { text: "Shoes for every runner." },
              { text: "Order today." },
            ],
          },
        },
      },
    ]);
  });

  it("sends dates, display paths and no criteria when they are given or empty", async () => {
    await createGoogleCampaign({
      ...create,
      google: {
        ...google,
        startDate: "2026-11-01",
        endDate: "2026-11-30",
        locationIds: [],
        languageIds: [],
        path1: "shoes",
        path2: "spring",
      },
    });
    expect(operationsOf("campaign_operation")[0]).toMatchObject({
      start_date_time: "2026-11-01 00:00:00",
      end_date_time: "2026-11-30 23:59:59",
    });
    expect(operationsOf("campaign_criterion_operation")).toEqual([]);
    expect(operationsOf("ad_group_ad_operation")[0]?.ad).toMatchObject({
      responsive_search_ad: { path1: "shoes", path2: "spring" },
    });
  });

  it("omits dates and paths that are not set", async () => {
    await createGoogleCampaign(create);
    const campaign = operationsOf("campaign_operation")[0];
    expect(campaign).not.toHaveProperty("start_date_time");
    expect(campaign).not.toHaveProperty("end_date_time");
    const ad = operationsOf("ad_group_ad_operation")[0]?.ad as {
      responsive_search_ad: object;
    };
    expect(ad.responsive_search_ad).not.toHaveProperty("path1");
    expect(ad.responsive_search_ad).not.toHaveProperty("path2");
  });

  it("adds sitelink and callout assets and links them to the campaign", async () => {
    await createGoogleCampaign({
      ...create,
      google: {
        ...google,
        sitelinks: [
          {
            text: "Shoes",
            finalUrl: "https://example.com/shoes",
            description1: "Light and fast",
            description2: "Free returns",
          },
          { text: "Sale", finalUrl: "https://example.com/sale" },
        ],
        callouts: ["Free shipping", "24/7 support"],
      },
    });
    const keys = operations().map((operation) => Object.keys(operation)[0]);
    expect(keys.slice(-8)).toEqual([
      "asset_operation",
      "asset_operation",
      "asset_operation",
      "asset_operation",
      "campaign_asset_operation",
      "campaign_asset_operation",
      "campaign_asset_operation",
      "campaign_asset_operation",
    ]);
    expect(keys.indexOf("asset_operation")).toBeGreaterThan(
      keys.indexOf("campaign_operation"),
    );
    expect(operationsOf("asset_operation")).toEqual([
      {
        resource_name: "customers/111/assets/-10",
        final_urls: ["https://example.com/shoes"],
        sitelink_asset: {
          link_text: "Shoes",
          description1: "Light and fast",
          description2: "Free returns",
        },
      },
      {
        resource_name: "customers/111/assets/-11",
        final_urls: ["https://example.com/sale"],
        sitelink_asset: { link_text: "Sale" },
      },
      {
        resource_name: "customers/111/assets/-12",
        callout_asset: { callout_text: "Free shipping" },
      },
      {
        resource_name: "customers/111/assets/-13",
        callout_asset: { callout_text: "24/7 support" },
      },
    ]);
    expect(operationsOf("campaign_asset_operation")).toEqual(
      [
        ["-10", "SITELINK"],
        ["-11", "SITELINK"],
        ["-12", "CALLOUT"],
        ["-13", "CALLOUT"],
      ].map(([id, field_type]) => ({
        campaign: "customers/111/campaigns/-2",
        asset: `customers/111/assets/${id}`,
        field_type,
      })),
    );
  });

  it("adds no asset operations without sitelinks and callouts", async () => {
    await createGoogleCampaign(create);
    await createGoogleCampaign({
      ...create,
      google: { ...google, sitelinks: [], callouts: [] },
    });
    for (const call of calls()) {
      expect(JSON.stringify(call.arguments.mutate_operations)).not.toContain(
        "asset_operation",
      );
    }
  });

  it("sends a repeated location or language once", async () => {
    await createGoogleCampaign({
      ...create,
      google: { ...google, locationIds: ["2276", "2276"], languageIds: [] },
    });
    expect(operationsOf("campaign_criterion_operation")).toHaveLength(1);
  });

  it("gives each budget its own name and keeps it within Google's length limit", async () => {
    const longName = "x".repeat(255);
    await createGoogleCampaign({ ...create, name: longName });
    await createGoogleCampaign({ ...create, name: longName });
    const names = calls().map(
      (call) =>
        call.arguments.mutate_operations[0].campaign_budget_operation.create
          .name as string,
    );
    expect(new Set(names).size).toBe(2);
    for (const name of names) expect(name.length).toBeLessThanOrEqual(255);
  });

  it("treats an empty partial failure error as none", async () => {
    executeToolMock.mockResolvedValue({
      ...batchResult,
      partial_failure_error: {},
    });
    await expect(createGoogleCampaign(create)).resolves.toMatch(/^\d+$/);
  });

  it.each([
    [
      "a partial failure",
      { ...batchResult, partial_failure_error: { code: 3 } },
    ],
    [
      "no campaign result",
      {
        mutate_operation_responses: [batchResult.mutate_operation_responses[0]],
      },
    ],
    ["no results", { mutate_operation_responses: [] }],
    ["an empty payload", null],
    [
      "a malformed campaign resource name",
      {
        mutate_operation_responses: [
          { campaign_result: { resource_name: "customers/111/campaigns/abc" } },
        ],
      },
    ],
  ])(
    "raises a tool error and still deletes the session for %s",
    async (_name, payload) => {
      executeToolMock.mockResolvedValue(payload);
      await expect(createGoogleCampaign(create)).rejects.toBeInstanceOf(
        ComposioToolError,
      );
      expect(deleteSessionMock).toHaveBeenCalled();
    },
  );

  describe("Google failures", () => {
    // What Google answers to a rejected mutate, as Composio wraps it
    // (seen live 2026-10-12): a prefix and the pretty-printed JSON body.
    const failure = (errorCode: Record<string, string>, message: string) =>
      `API Error (400): ${JSON.stringify(
        {
          error: {
            code: 400,
            message: "Request contains an invalid argument.",
            status: "INVALID_ARGUMENT",
            details: [
              {
                "@type":
                  "type.googleapis.com/google.ads.googleads.v23.errors.GoogleAdsFailure",
                errors: [
                  {
                    errorCode,
                    message,
                    trigger: { stringValue: "A headline that is far too long" },
                    location: {
                      fieldPathElements: [
                        { fieldName: "mutate_operations", index: 8 },
                      ],
                    },
                  },
                  { errorCode: { mutateError: "x" }, message: "Second error." },
                ],
                requestId: "Yk3KzjQ-rjBMi4jqZH36zg",
              },
            ],
          },
        },
        null,
        2,
      )}`;
    const rejected = (providerMessage: string) =>
      executeToolMock.mockRejectedValue(
        new ComposioToolError({ message: "refused", providerMessage }),
      );

    it("raises 422 with Google's first error message", async () => {
      rejected(failure({ stringLengthError: "TOO_LONG" }, "Too long."));
      await expect(createGoogleCampaign(create)).rejects.toMatchObject({
        status: 422,
        message: "Too long.",
      });
      expect(deleteSessionMock).toHaveBeenCalled();
    });

    it("reads a snake_case failure and unescapes the message", async () => {
      rejected(
        `{"details":[{"errors":[{"error_code":{"policy_violation_error":"POLICY_ERROR"},"message":"Destination \\"not\\" working"}]}]}`,
      );
      await expect(createGoogleCampaign(create)).rejects.toMatchObject({
        status: 422,
        message: 'Destination "not" working',
      });
    });

    it.each([
      ["authentication", { authenticationError: "OAUTH_TOKEN_EXPIRED" }],
      ["authorization", { authorizationError: "USER_PERMISSION_DENIED" }],
      ["quota", { quotaError: "RESOURCE_EXHAUSTED" }],
      ["internal", { internalError: "INTERNAL_ERROR" }],
      [
        "concurrent modification",
        { concurrentModificationError: "CONCURRENT_MODIFICATION" },
      ],
    ])("keeps a %s failure a provider error", async (_name, errorCode) => {
      const error = new ComposioToolError({
        message: "refused",
        providerMessage: failure(errorCode, "Not for the user."),
      });
      executeToolMock.mockRejectedValue(error);
      await expect(createGoogleCampaign(create)).rejects.toBe(error);
    });

    it.each([
      ["a message without a Google failure", "Request failed with status 500"],
      ["no message", null],
    ])(
      "keeps a tool error with %s unchanged",
      async (_name, providerMessage) => {
        const error = new ComposioToolError({
          message: "refused",
          providerMessage,
        });
        executeToolMock.mockRejectedValue(error);
        await expect(createGoogleCampaign(create)).rejects.toBe(error);
      },
    );

    it("keeps transport errors unchanged", async () => {
      const error = new ComposioApiError(502, undefined, "gateway");
      executeToolMock.mockRejectedValue(error);
      await expect(createGoogleCampaign(create)).rejects.toBe(error);
    });
  });
});

describe("Google targeting lookups", () => {
  const lookup = { ...input, customerId: "111" };

  beforeEach(() => {
    vi.resetAllMocks();
    createSessionMock.mockResolvedValue("sess_1");
  });

  describe("searchGoogleLocations", () => {
    const SUGGEST =
      "https://googleads.googleapis.com/v23/geoTargetConstants:suggest";
    const connected = {
      connectedAccountId: "ca_google",
      executorUserId: "sokosumi:project-executor:project_1",
    };

    function suggestion(
      id: string | number,
      name: string,
      extra: Record<string, unknown> = {},
    ) {
      return {
        geoTargetConstant: {
          resourceName: `geoTargetConstants/${id}`,
          status: "ENABLED",
          id,
          name,
          canonicalName: name,
          ...extra,
        },
        locale: "en",
        reach: "100",
      };
    }

    /** Composio's proxy wraps Google's body as `data`. */
    function proxied(data: unknown, status = 200) {
      proxyFetchMock.mockImplementation(
        async () => new Response(JSON.stringify({ data, status, headers: {} })),
      );
    }
    const suggestions = (list: unknown[]) =>
      proxied({ geoTargetConstantSuggestions: list });

    it("suggests locations by name through the proxy, without a session", async () => {
      suggestions([]);
      await searchGoogleLocations({ ...connected, q: "müNCHEN" });
      expect(proxyFetchMock).toHaveBeenCalledTimes(1);
      expect(proxyFetchMock).toHaveBeenCalledWith(
        "/api/v3/tools/execute/proxy",
        {
          method: "POST",
          jsonBody: {
            connected_account_id: "ca_google",
            endpoint: SUGGEST,
            method: "POST",
            body: { locale: "en", locationNames: { names: ["müNCHEN"] } },
          },
        },
      );
      expect(createSessionMock).not.toHaveBeenCalled();
    });

    it("looks locations up by id", async () => {
      suggestions([]);
      await searchGoogleLocations({ ...connected, ids: ["2372", "2840"] });
      expect(proxyFetchMock.mock.calls[0]?.[1].jsonBody).toEqual({
        connected_account_id: "ca_google",
        endpoint: SUGGEST,
        method: "POST",
        body: {
          locale: "en",
          geoTargets: {
            geoTargetConstants: [
              "geoTargetConstants/2372",
              "geoTargetConstants/2840",
            ],
          },
        },
      });
    });

    it("maps suggestions in Google's order, coercing ids and keeping missing fields null", async () => {
      suggestions([
        suggestion("2276", "Germany", {
          canonicalName: "Germany",
          targetType: "Country",
          countryCode: "DE",
        }),
        suggestion(1003854, "Berlin", {
          canonicalName: "Berlin,Berlin,Germany",
        }),
      ]);
      expect(await searchGoogleLocations({ ...connected, q: "Ger" })).toEqual([
        {
          id: "2276",
          name: "Germany",
          canonicalName: "Germany",
          targetType: "Country",
          countryCode: "DE",
        },
        {
          id: "1003854",
          name: "Berlin",
          canonicalName: "Berlin,Berlin,Germany",
          targetType: null,
          countryCode: null,
        },
      ]);
    });

    it("drops suggestions that are not enabled", async () => {
      suggestions([
        suggestion("1", "Gone", { status: "REMOVAL_PLANNED" }),
        suggestion("2", "Unknown", { status: undefined }),
        suggestion("3", "Kept"),
      ]);
      const found = await searchGoogleLocations({ ...connected, q: "x" });
      expect(found.map(({ id }) => id)).toEqual(["3"]);
    });

    it("keeps the first of a repeated id", async () => {
      suggestions([
        suggestion("1", "One"),
        suggestion("2", "Two"),
        suggestion("1", "One again"),
      ]);
      const found = await searchGoogleLocations({ ...connected, q: "x" });
      expect(found.map(({ name }) => name)).toEqual(["One", "Two"]);
    });

    it("caps a name search at 20 but returns every requested id", async () => {
      const list = Array.from({ length: 25 }, (_, i) =>
        suggestion(i + 1, `Place ${i + 1}`),
      );
      suggestions(list);
      expect(
        await searchGoogleLocations({ ...connected, q: "place" }),
      ).toHaveLength(20);
      const ids = list.map((_, i) => String(i + 1));
      expect(await searchGoogleLocations({ ...connected, ids })).toHaveLength(
        25,
      );
    });

    it("returns no locations when Google omits the suggestions", async () => {
      proxied({});
      expect(
        await searchGoogleLocations({ ...connected, q: "Nowhere" }),
      ).toEqual([]);
    });

    it.each([
      ["no ids", []],
      ["26 ids", Array.from({ length: 26 }, (_, i) => String(i + 1))],
    ])("refuses %s before calling Google", async (_name, ids) => {
      await expect(
        searchGoogleLocations({ ...connected, ids }),
      ).rejects.toMatchObject({ status: 422 });
      expect(proxyFetchMock).not.toHaveBeenCalled();
    });

    it("raises a provider error for a proxied status outside 2xx", async () => {
      proxied(
        { error: { code: 403, message: "The caller is not allowed." } },
        403,
      );
      await expect(
        searchGoogleLocations({ ...connected, q: "Berlin" }),
      ).rejects.toMatchObject({
        name: "ComposioToolError",
        providerStatus: 403,
        providerMessage: "The caller is not allowed.",
      });
      proxied("<html>bad gateway</html>", 502);
      await expect(
        searchGoogleLocations({ ...connected, q: "Berlin" }),
      ).rejects.toMatchObject({ providerStatus: 502, providerMessage: null });
    });

    it("raises an HTTP failure of the proxy itself", async () => {
      proxyFetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
      await expect(
        searchGoogleLocations({ ...connected, q: "Berlin" }),
      ).rejects.toBeInstanceOf(ComposioApiError);
    });

    it.each([
      ["a body without data and status", { unexpected: true }],
      ["a data that is not an object", { status: 200, data: "text" }],
      [
        "a suggestion without an id",
        {
          status: 200,
          data: {
            geoTargetConstantSuggestions: [
              { geoTargetConstant: { name: "no id", status: "ENABLED" } },
            ],
          },
        },
      ],
    ])("raises %s as an invalid response", async (_name, body) => {
      proxyFetchMock.mockResolvedValue(new Response(JSON.stringify(body)));
      await expect(
        searchGoogleLocations({ ...connected, q: "Berlin" }),
      ).rejects.toThrow(/invalid response/);
    });
  });

  describe("listGoogleLanguages", () => {
    it("lists targetable languages sorted by name", async () => {
      executeToolMock.mockResolvedValue({
        results: [
          { languageConstant: { id: "1001", code: "de", name: "German" } },
          { languageConstant: { id: 1000, code: "en", name: "English" } },
          { languageConstant: { id: "1003", code: "es", name: "Spanish" } },
        ],
      });
      expect(await listGoogleLanguages(lookup)).toEqual([
        { id: "1000", code: "en", name: "English" },
        { id: "1001", code: "de", name: "German" },
        { id: "1003", code: "es", name: "Spanish" },
      ]);
      expect(executeToolMock).toHaveBeenCalledWith(
        expect.objectContaining({
          toolSlug: "GOOGLEADS_SEARCH_STREAM_GAQL",
          arguments: {
            customer_id: "111",
            query:
              "SELECT language_constant.id, language_constant.code, language_constant.name FROM language_constant WHERE language_constant.targetable = TRUE",
          },
        }),
      );
      expect(deleteSessionMock).toHaveBeenCalled();
    });

    it("raises a payload without a results list", async () => {
      executeToolMock.mockResolvedValue(null);
      await expect(listGoogleLanguages(lookup)).rejects.toBeInstanceOf(
        ComposioApiError,
      );
    });
  });
});
