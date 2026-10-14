import { SsrfError } from "@sokosumi/net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ComposioApiError } from "@/clients/composio.client";
import { ComposioToolError } from "@/clients/social-post-providers/tools";

const {
  createSessionMock,
  executeToolMock,
  deleteSessionMock,
  proxyFetchMock,
  ssrfSafeFetchMock,
} = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  executeToolMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  proxyFetchMock: vi.fn(),
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@sokosumi/net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/net")>()),
  ssrfSafeFetch: ssrfSafeFetchMock,
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
  editGoogleCampaign,
  getGoogleCampaignDetails,
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
      // Listed but not queryable (cancelled / no access to this customer).
      throw new ComposioToolError({
        message: "no access",
        providerMessage: `API Error (400): ${JSON.stringify({
          details: [
            {
              errors: [
                {
                  errorCode: { authorizationError: "USER_PERMISSION_DENIED" },
                  message: "User doesn't have permission to access customer.",
                },
              ],
            },
          ],
        })}`,
      });
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

  it("propagates auth and quota tool failures instead of an empty list", async () => {
    const refused = new ComposioToolError({
      message: "refused",
      providerMessage: `API Error (400): ${JSON.stringify({
        details: [
          {
            errors: [
              {
                errorCode: { quotaError: "RESOURCE_EXHAUSTED" },
                message: "Too many requests.",
              },
            ],
          },
        ],
      })}`,
    });
    executeToolMock.mockImplementation(async (call: { toolSlug: string }) => {
      if (call.toolSlug === "GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS") {
        return { resourceNames: ["customers/111"] };
      }
      throw refused;
    });
    await expect(listGoogleAdAccounts(input)).rejects.toBe(refused);
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
    ["budget", { dailyBudget: 5 }],
    ["status", { status: "PAUSED" as const }],
  ])(
    "raises Google's validation message as 422 for a %s change",
    async (_name, change) => {
      const rejected = new ComposioToolError({
        message: "refused",
        providerMessage: failure(
          { policyViolationError: "POLICY_ERROR" },
          "Budget is too low.",
        ),
      });
      executeToolMock.mockImplementation(async (call: { toolSlug: string }) => {
        if (call.toolSlug === "GOOGLEADS_SEARCH_STREAM_GAQL") return lookup();
        throw rejected;
      });
      await expect(
        updateGoogleCampaign({ ...update, ...change }),
      ).rejects.toMatchObject({ status: 422, message: "Budget is too low." });
      expect(deleteSessionMock).toHaveBeenCalled();
    },
  );

  it("keeps an authentication failure a provider error", async () => {
    const rejected = new ComposioToolError({
      message: "refused",
      providerMessage: failure(
        { authenticationError: "OAUTH_TOKEN_EXPIRED" },
        "Expired.",
      ),
    });
    executeToolMock.mockImplementation(async (call: { toolSlug: string }) => {
      if (call.toolSlug === "GOOGLEADS_SEARCH_STREAM_GAQL") return lookup();
      throw rejected;
    });
    await expect(
      updateGoogleCampaign({ ...update, status: "PAUSED" }),
    ).rejects.toBe(rejected);
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
    expect(JSON.stringify(operationsOf("ad_group_ad_operation"))).not.toContain(
      '"logo_images"',
    );
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

describe("createGoogleCampaign for Display", () => {
  const BLOB = "https://store.public.blob.vercel-storage.com/drive/users/u1";
  const image = (
    name: string,
    role: "LANDSCAPE" | "SQUARE" | "LOGO",
    mimeType: "image/png" | "image/jpeg" | "image/gif" = "image/png",
  ) => ({
    pathname: `drive/users/u1/${name}`,
    fileUrl: `${BLOB}/${name}`,
    name,
    size: 3,
    mimeType,
    role,
  });
  const wide = image("wide.png", "LANDSCAPE");
  const square = image("square.jpg", "SQUARE", "image/jpeg");
  const logo = image("logo.gif", "LOGO", "image/gif");
  const google = {
    type: "DISPLAY" as const,
    locationIds: ["2276"],
    languageIds: ["1001"],
    finalUrl: "https://example.com/spring",
    businessName: "Acme Shoes",
    headlines: ["Run faster", "Light shoes"],
    longHeadline: "Run faster in the lightest shoes",
    descriptions: ["Shoes for every runner."],
    images: [wide, square, logo],
  };
  const create = {
    ...input,
    customerId: "111",
    name: "Spring sale",
    dailyBudget: 12.34,
    google,
  };
  const assetResult = (id: number) => ({
    mutate_operation_responses: [
      { asset_result: { resource_name: `customers/111/assets/${id}` } },
    ],
  });
  const treeResult = {
    mutate_operation_responses: [
      { campaign_result: { resource_name: "customers/111/campaigns/42" } },
    ],
  };
  const served: Record<string, { type: string; bytes: number[] }> = {
    "wide.png": { type: "image/png", bytes: [1, 2, 3] },
    "square.jpg": { type: "image/jpeg; charset=binary", bytes: [4, 5, 6] },
    "logo.gif": { type: "image/gif", bytes: [7, 8, 9] },
  };
  const calls = () => executeToolMock.mock.calls.map(([call]) => call);
  const tree = () => calls().at(-1);
  const operationsOf = (key: string) =>
    (
      tree()?.arguments.mutate_operations as Record<
        string,
        Record<string, Record<string, unknown>>
      >[]
    )
      .filter((operation) => key in operation)
      .map((operation) => operation[key]?.create);

  beforeEach(() => {
    vi.resetAllMocks();
    createSessionMock.mockResolvedValue("sess_1");
    ssrfSafeFetchMock.mockImplementation(async (url: string) => {
      const file = served[url.slice(url.lastIndexOf("/") + 1)];
      return file
        ? new Response(new Uint8Array(file.bytes), {
            headers: { "content-type": file.type },
          })
        : new Response(null, { status: 404 });
    });
    let assetId = 100;
    executeToolMock.mockImplementation(
      async (call: { arguments: { mutate_operations: object[] } }) =>
        "asset_operation" in (call.arguments.mutate_operations[0] ?? {})
          ? assetResult(assetId++)
          : treeResult,
    );
  });

  it("downloads each image through the SSRF guard with the 5120 KB cap", async () => {
    await createGoogleCampaign(create);
    expect(ssrfSafeFetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${BLOB}/wide.png`,
      `${BLOB}/square.jpg`,
      `${BLOB}/logo.gif`,
    ]);
    for (const [, options] of ssrfSafeFetchMock.mock.calls) {
      expect(options).toMatchObject({
        maxResponseBytes: 5_242_880,
        signal: expect.any(AbortSignal),
      });
    }
  });

  it("uploads every image in a call of its own, then creates the tree and returns the campaign id", async () => {
    await expect(createGoogleCampaign(create)).resolves.toBe("42");
    expect(calls()).toHaveLength(4);
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ toolSlugs: ["GOOGLEADS_BATCH_MUTATE"] }),
    );
    const uploads = calls().slice(0, 3);
    const encoded = ["AQID", "BAUG", "BwgJ"];
    const names = ["wide.png", "square.jpg", "logo.gif"];
    uploads.forEach((call, index) => {
      expect(call).toEqual({
        sessionId: "sess_1",
        toolSlug: "GOOGLEADS_BATCH_MUTATE",
        arguments: {
          customer_id: "111",
          partial_failure: false,
          mutate_operations: [
            {
              asset_operation: {
                create: {
                  name: expect.stringMatching(
                    new RegExp(
                      `^${names[index]?.replace(".", "\\.")} [0-9a-f]{8}$`,
                    ),
                  ),
                  type: "IMAGE",
                  image_asset: { data: encoded[index] },
                },
              },
            },
          ],
        },
        context: "run GOOGLEADS_BATCH_MUTATE",
        refused: expect.any(String),
        timeoutMs: 60_000,
      });
    });
    expect(deleteSessionMock).toHaveBeenCalledTimes(1);
  });

  it("sends the tree after the uploads, with the image assets in their slots", async () => {
    await createGoogleCampaign(create);
    expect(tree()?.timeoutMs).toBeUndefined();
    const operations = tree()?.arguments.mutate_operations as Record<
      string,
      unknown
    >[];
    expect(operations.map((operation) => Object.keys(operation)[0])).toEqual([
      "campaign_budget_operation",
      "campaign_operation",
      "campaign_criterion_operation",
      "campaign_criterion_operation",
      "ad_group_operation",
      "ad_group_ad_operation",
    ]);
    expect(operationsOf("campaign_operation")).toEqual([
      {
        resource_name: "customers/111/campaigns/-2",
        name: "Spring sale",
        status: "PAUSED",
        advertising_channel_type: "DISPLAY",
        campaign_budget: "customers/111/campaignBudgets/-1",
        target_spend: {},
        contains_eu_political_advertising:
          "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
      },
    ]);
    expect(operationsOf("campaign_criterion_operation")).toEqual([
      {
        campaign: "customers/111/campaigns/-2",
        location: { geo_target_constant: "geoTargetConstants/2276" },
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
        type: "DISPLAY_STANDARD",
      },
    ]);
    expect(operationsOf("ad_group_ad_operation")).toEqual([
      {
        ad_group: "customers/111/adGroups/-3",
        status: "ENABLED",
        ad: {
          final_urls: ["https://example.com/spring"],
          responsive_display_ad: {
            marketing_images: [{ asset: "customers/111/assets/100" }],
            square_marketing_images: [{ asset: "customers/111/assets/101" }],
            square_logo_images: [{ asset: "customers/111/assets/102" }],
            headlines: [{ text: "Run faster" }, { text: "Light shoes" }],
            long_headline: { text: "Run faster in the lightest shoes" },
            descriptions: [{ text: "Shoes for every runner." }],
            business_name: "Acme Shoes",
          },
        },
      },
    ]);
  });

  it("sends no sitelinks, callouts or keywords", async () => {
    await createGoogleCampaign(create);
    expect(operationsOf("asset_operation")).toEqual([]);
    expect(operationsOf("campaign_asset_operation")).toEqual([]);
    expect(operationsOf("ad_group_criterion_operation")).toEqual([]);
  });

  it("keeps several images of a slot in order and omits square_logo_images without logos", async () => {
    const wide2 = image("wide2.png", "LANDSCAPE");
    served["wide2.png"] = { type: "image/png", bytes: [1] };
    await createGoogleCampaign({
      ...create,
      google: { ...google, images: [wide, wide2, square] },
    });
    const ad = operationsOf("ad_group_ad_operation")[0]?.ad as {
      responsive_display_ad: Record<string, unknown>;
    };
    expect(ad.responsive_display_ad.marketing_images).toEqual([
      { asset: "customers/111/assets/100" },
      { asset: "customers/111/assets/101" },
    ]);
    expect(ad.responsive_display_ad.square_marketing_images).toEqual([
      { asset: "customers/111/assets/102" },
    ]);
    expect(ad.responsive_display_ad).not.toHaveProperty("square_logo_images");
    expect(ad.responsive_display_ad).not.toHaveProperty("logo_images");
    delete served["wide2.png"];
  });

  it("keeps the asset name within Google's length limit", async () => {
    const long = image(`${"a".repeat(200)}.png`, "LANDSCAPE");
    served[long.name] = { type: "image/png", bytes: [1] };
    await createGoogleCampaign({
      ...create,
      google: { ...google, images: [long, square] },
    });
    const name = (
      calls()[0]?.arguments.mutate_operations[0].asset_operation.create as {
        name: string;
      }
    ).name;
    expect(name.length).toBeLessThanOrEqual(128);
    delete served[long.name];
  });

  it("does not split a surrogate pair when it truncates the asset name", async () => {
    const emoji = image(
      `${"a".repeat(118)}\u{1F600}\u{1F600}.png`,
      "LANDSCAPE",
    );
    served[emoji.name] = { type: "image/png", bytes: [1] };
    await createGoogleCampaign({
      ...create,
      google: { ...google, images: [emoji, square] },
    });
    const name = (
      calls()[0]?.arguments.mutate_operations[0].asset_operation.create as {
        name: string;
      }
    ).name;
    expect(name).toBe(name.toWellFormed());
    expect(name.startsWith(`${"a".repeat(118)}\u{1F600} `)).toBe(true);
    delete served[emoji.name];
  });

  describe("downloads", () => {
    const rejectsBeforeWriting = async (message: string | RegExp) => {
      await expect(createGoogleCampaign(create)).rejects.toMatchObject({
        status: 422,
        message: expect.stringMatching(message),
      });
      expect(createSessionMock).not.toHaveBeenCalled();
      expect(executeToolMock).not.toHaveBeenCalled();
    };

    it("raises 422 naming the file when it is larger than the cap", async () => {
      ssrfSafeFetchMock.mockRejectedValue(
        new SsrfError("Response exceeds maxResponseBytes"),
      );
      await rejectsBeforeWriting(/"wide\.png".*5120 KB/);
    });

    it("raises 422 naming the file when it is larger than the cap after the download", async () => {
      ssrfSafeFetchMock.mockResolvedValue(
        new Response(new Uint8Array(5_242_881), {
          headers: { "content-type": "image/png" },
        }),
      );
      await rejectsBeforeWriting(/"wide\.png".*5120 KB/);
    });

    it("raises 422 naming the file when it is no longer there", async () => {
      ssrfSafeFetchMock.mockResolvedValue(new Response(null, { status: 404 }));
      await rejectsBeforeWriting(/"wide\.png".*no longer available/);
    });

    it.each(["image/webp", "text/html", "application/octet-stream", ""])(
      "raises 422 naming the file when it is served as %j",
      async (type) => {
        ssrfSafeFetchMock.mockResolvedValue(
          new Response(new Uint8Array([1]), {
            headers: type ? { "content-type": type } : {},
          }),
        );
        await rejectsBeforeWriting(/"wide\.png".*JPEG, PNG or GIF/);
      },
    );

    it("keeps other fetch failures unchanged", async () => {
      const error = new SsrfError("blocked host");
      ssrfSafeFetchMock.mockRejectedValue(error);
      await expect(createGoogleCampaign(create)).rejects.toBe(error);
      expect(executeToolMock).not.toHaveBeenCalled();
    });

    it("downloads nothing for a Search campaign", async () => {
      executeToolMock.mockResolvedValue(treeResult);
      await createGoogleCampaign({
        ...create,
        google: {
          type: "SEARCH",
          locationIds: [],
          languageIds: [],
          finalUrl: "https://example.com",
          keywords: [{ text: "shoes", matchType: "BROAD" }],
          headlines: ["One", "Two", "Three"],
          descriptions: ["First description", "Second description"],
        },
      });
      expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
    });
  });

  describe("failures", () => {
    const failure = (message: string) =>
      `API Error (400): ${JSON.stringify({
        error: {
          details: [
            {
              errors: [
                {
                  errorCode: { imageError: "INVALID_IMAGE" },
                  message,
                },
              ],
            },
          ],
        },
      })}`;

    it("raises 422 naming the image when Google rejects an upload, and stops there", async () => {
      executeToolMock
        .mockResolvedValueOnce(assetResult(100))
        .mockRejectedValueOnce(
          new ComposioToolError({
            message: "refused",
            providerMessage: failure("The image is too small."),
          }),
        );
      await expect(createGoogleCampaign(create)).rejects.toMatchObject({
        status: 422,
        message: 'Image "square.jpg": The image is too small.',
      });
      expect(calls()).toHaveLength(2);
      expect(deleteSessionMock).toHaveBeenCalled();
    });

    it("keeps a provider failure of an upload unchanged", async () => {
      const error = new ComposioApiError(502, undefined, "gateway");
      executeToolMock.mockRejectedValue(error);
      await expect(createGoogleCampaign(create)).rejects.toBe(error);
      expect(calls()).toHaveLength(1);
    });

    it.each([
      ["no asset result", { mutate_operation_responses: [] }],
      ["an empty payload", null],
      [
        "a malformed resource name",
        {
          mutate_operation_responses: [
            { asset_result: { resource_name: "customers/111/assets/abc" } },
          ],
        },
      ],
      [
        "a partial failure",
        { ...assetResult(100), partial_failure_error: { code: 3 } },
      ],
    ])("raises a tool error for an upload with %s", async (_name, payload) => {
      executeToolMock.mockResolvedValue(payload);
      await expect(createGoogleCampaign(create)).rejects.toBeInstanceOf(
        ComposioToolError,
      );
      expect(calls()).toHaveLength(1);
    });

    it("raises the tree failure after the uploads without retrying", async () => {
      executeToolMock
        .mockResolvedValueOnce(assetResult(100))
        .mockResolvedValueOnce(assetResult(101))
        .mockResolvedValueOnce(assetResult(102))
        .mockRejectedValueOnce(
          new ComposioToolError({
            message: "refused",
            providerMessage: failure("Destination not working"),
          }),
        );
      await expect(createGoogleCampaign(create)).rejects.toMatchObject({
        status: 422,
        message: "Destination not working",
      });
      expect(calls()).toHaveLength(4);
      expect(deleteSessionMock).toHaveBeenCalled();
    });

    it("raises a tool error for a tree without a campaign result", async () => {
      executeToolMock.mockImplementation(
        async (call: { arguments: { mutate_operations: object[] } }) =>
          "asset_operation" in (call.arguments.mutate_operations[0] ?? {})
            ? assetResult(100)
            : { mutate_operation_responses: [] },
      );
      await expect(createGoogleCampaign(create)).rejects.toBeInstanceOf(
        ComposioToolError,
      );
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

const campaignRow = (overrides: Record<string, unknown> = {}) => ({
  customer: { timeZone: "Europe/Berlin", currencyCode: "EUR" },
  campaign: {
    id: "42",
    name: "Brand search",
    status: "ENABLED",
    advertisingChannelType: "SEARCH",
    biddingStrategyType: "MAXIMIZE_CLICKS",
    campaignBudget: "customers/111/campaignBudgets/7",
    startDateTime: "2026-10-01 00:00:00",
    endDateTime: "2026-12-31 23:59:59",
    ...overrides,
  },
  campaignBudget: { amountMicros: "12500000", explicitlyShared: false },
});

const rsa = {
  adGroupAd: {
    status: "ENABLED",
    adStrength: "GOOD",
    policySummary: { approvalStatus: "APPROVED", reviewStatus: "REVIEWED" },
    ad: {
      id: "900",
      type: "RESPONSIVE_SEARCH_AD",
      finalUrls: ["https://example.com"],
      responsiveSearchAd: {
        headlines: [{ text: "Buy shoes" }, { text: "Run fast" }],
        descriptions: [{ text: "Free shipping" }],
        path1: "shoes",
      },
    },
  },
  adGroup: { id: "7" },
};

const rda = {
  adGroupAd: {
    status: "ENABLED",
    ad: {
      id: "901",
      type: "RESPONSIVE_DISPLAY_AD",
      finalUrls: ["https://example.com/display"],
      responsiveDisplayAd: {
        marketingImages: [
          { asset: "customers/111/assets/1" },
          { asset: "customers/111/assets/404" },
        ],
        squareMarketingImages: [{ asset: "customers/111/assets/2" }],
        squareLogoImages: [{ asset: "customers/111/assets/3" }],
        headlines: [{ text: "Shoes" }],
        longHeadline: { text: "The best running shoes" },
        descriptions: [{ text: "Fast" }],
        businessName: "Acme",
      },
    },
  },
  adGroup: { id: "7" },
};

const imageAsset = (id: number, width: number, height: number) => ({
  asset: {
    resourceName: `customers/111/assets/${id}`,
    id: String(id),
    imageAsset: {
      fullSize: {
        url: `https://img.example.com/${id}`,
        widthPixels: String(width),
        heightPixels: String(height),
      },
    },
  },
});

/** One result set per query; override a key to change what Google returns. */
const base: Record<string, unknown[]> = {
  campaign: [campaignRow()],
  criteria: [
    {
      campaignCriterion: {
        criterionId: "21",
        type: "LOCATION",
        location: { geoTargetConstant: "geoTargetConstants/2276" },
      },
    },
    {
      campaignCriterion: {
        criterionId: "22",
        type: "LANGUAGE",
        language: { languageConstant: "languageConstants/1001" },
      },
      languageConstant: { id: "1001", code: "de", name: "German" },
    },
  ],
  geo: [
    {
      geoTargetConstant: {
        id: "2276",
        name: "Germany",
        canonicalName: "Germany",
        targetType: "Country",
        countryCode: "DE",
      },
    },
  ],
  adGroups: [{ adGroup: { id: "7", status: "ENABLED" } }],
  keywords: [
    {
      adGroupCriterion: {
        criterionId: "11",
        keyword: { text: "running shoes", matchType: "EXACT" },
        status: "ENABLED",
        approvalStatus: "APPROVED",
      },
    },
  ],
  ads: [rsa],
  images: [],
  assets: [
    {
      campaignAsset: { fieldType: "SITELINK", status: "ENABLED" },
      asset: {
        id: "50",
        finalUrls: ["https://example.com/sale"],
        sitelinkAsset: { linkText: "Sale", description1: "Up to 50%" },
        policySummary: { approvalStatus: "APPROVED" },
      },
    },
    {
      campaignAsset: { fieldType: "CALLOUT", status: "ENABLED" },
      asset: { id: "51", calloutAsset: { calloutText: "Free returns" } },
    },
  ],
  daily: [
    {
      segments: { date: "2026-10-12" },
      metrics: {
        costMicros: "10000000",
        impressions: "400",
        clicks: "20",
        conversions: 1.5,
      },
    },
  ],
};

function mockResults(
  overrides: Record<string, unknown[]> = {},
  mutate?: (call: {
    toolSlug: string;
    arguments: { mutate_operations: object[] };
  }) => unknown,
) {
  const results = { ...base, ...overrides };
  executeToolMock.mockImplementation(
    async (call: {
      toolSlug: string;
      arguments: { query: string; mutate_operations: object[] };
    }) => {
      if (call.toolSlug === "GOOGLEADS_BATCH_MUTATE") return mutate?.(call);
      const query = call.arguments.query;
      const patterns: [RegExp, string][] = [
        [/FROM campaign_criterion/, "criteria"],
        [/FROM geo_target_constant/, "geo"],
        [/FROM ad_group WHERE/, "adGroups"],
        [/FROM ad_group_criterion/, "keywords"],
        [/FROM ad_group_ad/, "ads"],
        [/FROM asset WHERE/, "images"],
        [/FROM campaign_asset/, "assets"],
        [/segments\.date DURING/, "daily"],
        [/FROM campaign WHERE/, "campaign"],
      ];
      const key = patterns.find(([pattern]) => pattern.test(query))?.[1];
      return {
        results: key && results[key],
        fieldMask: "x",
        requestId: "req",
      };
    },
  );
}

describe("getGoogleCampaignDetails", () => {
  const detailsInput = {
    ...input,
    customerId: "111",
    campaignId: "42",
    currency: "EUR",
    range: "LAST_7_DAYS" as const,
  };

  const queries = () =>
    executeToolMock.mock.calls.map(([call]) => call.arguments.query as string);

  beforeEach(() => {
    vi.resetAllMocks();
    vi.setSystemTime(new Date("2026-10-14T10:00:00.000Z"));
    createSessionMock.mockResolvedValue("sess_1");
    mockResults();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads a Search campaign", async () => {
    const details = await getGoogleCampaignDetails(detailsInput);
    expect(details.campaign).toEqual({
      id: "42",
      name: "Brand search",
      status: "ACTIVE",
      type: "SEARCH",
      channelType: "SEARCH",
      dailyBudget: 12.5,
      currency: "EUR",
      biddingStrategyType: "MAXIMIZE_CLICKS",
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      started: true,
      editable: true,
      notEditableReason: null,
    });
    expect(queries().some((q) => /customer\.currency_code/.test(q))).toBe(true);
    expect(details.targeting).toEqual({
      locations: [
        {
          id: "2276",
          name: "Germany",
          canonicalName: "Germany",
          targetType: "Country",
          countryCode: "DE",
        },
      ],
      languages: [{ id: "1001", code: "de", name: "German" }],
    });
    expect(details.keywords).toEqual([
      {
        id: "11",
        text: "running shoes",
        matchType: "EXACT",
        status: "ENABLED",
        approvalStatus: "APPROVED",
      },
    ]);
    expect(details.ad).toEqual({
      id: "900",
      status: "ENABLED",
      approvalStatus: "APPROVED",
      reviewStatus: "REVIEWED",
      adStrength: "GOOD",
      finalUrl: "https://example.com",
      search: {
        headlines: ["Buy shoes", "Run fast"],
        descriptions: ["Free shipping"],
        path1: "shoes",
        path2: null,
      },
    });
    expect(details.sitelinks).toEqual([
      {
        assetId: "50",
        text: "Sale",
        finalUrl: "https://example.com/sale",
        description1: "Up to 50%",
        description2: null,
        approvalStatus: "APPROVED",
      },
    ]);
    expect(details.callouts).toEqual([
      { assetId: "51", text: "Free returns", approvalStatus: null },
    ]);
  });

  it("keeps three-decimal budget precision for KWD", async () => {
    mockResults({
      campaign: [
        {
          ...campaignRow(),
          customer: { timeZone: "Asia/Kuwait", currencyCode: "KWD" },
          campaignBudget: {
            amountMicros: "1234000",
            explicitlyShared: false,
          },
        },
      ],
    });
    const details = await getGoogleCampaignDetails({
      ...detailsInput,
      currency: "KWD",
    });
    expect(details.campaign.dailyBudget).toBe(1.234);
  });

  it("reads a Display ad with its images in role order, skipping a missing asset", async () => {
    mockResults({
      campaign: [campaignRow({ advertisingChannelType: "DISPLAY" })],
      ads: [rda],
      images: [
        imageAsset(3, 128, 128),
        imageAsset(1, 1200, 628),
        imageAsset(2, 600, 600),
      ],
    });
    const details = await getGoogleCampaignDetails(detailsInput);
    expect(details.campaign).toMatchObject({
      type: "DISPLAY",
      editable: true,
      notEditableReason: null,
    });
    // Keywords are Search only, even when Google returns some.
    expect(details.keywords).toEqual([]);
    expect(details.ad).toEqual({
      id: "901",
      status: "ENABLED",
      approvalStatus: null,
      reviewStatus: null,
      adStrength: null,
      finalUrl: "https://example.com/display",
      display: {
        businessName: "Acme",
        headlines: ["Shoes"],
        longHeadline: "The best running shoes",
        descriptions: ["Fast"],
        images: [
          {
            assetId: "1",
            role: "LANDSCAPE",
            url: "https://img.example.com/1",
            width: 1200,
            height: 628,
          },
          {
            assetId: "2",
            role: "SQUARE",
            url: "https://img.example.com/2",
            width: 600,
            height: 600,
          },
          {
            assetId: "3",
            role: "LOGO",
            url: "https://img.example.com/3",
            width: 128,
            height: 128,
          },
        ],
      },
    });
    const imageQuery = queries().find((q) => q.includes("FROM asset WHERE"));
    expect(imageQuery).toContain(
      "'customers/111/assets/1', 'customers/111/assets/404', 'customers/111/assets/2', 'customers/111/assets/3'",
    );
  });

  it("reports a location without target type or country code as null", async () => {
    mockResults({
      geo: [
        {
          geoTargetConstant: {
            id: "2276",
            name: "Germany",
            canonicalName: "Germany",
          },
        },
      ],
    });
    expect(
      (await getGoogleCampaignDetails(detailsInput)).targeting.locations,
    ).toEqual([
      {
        id: "2276",
        name: "Germany",
        canonicalName: "Germany",
        targetType: null,
        countryCode: null,
      },
    ]);
  });

  it("handles a campaign with nothing around it", async () => {
    mockResults({
      campaign: [
        campaignRow({ startDateTime: undefined, endDateTime: undefined }),
      ],
      criteria: [],
      adGroups: [],
      keywords: [],
      ads: [],
      assets: [],
      daily: [],
    });
    const details = await getGoogleCampaignDetails(detailsInput);
    expect(details.campaign).toMatchObject({
      startDate: null,
      endDate: null,
      started: false,
      editable: false,
      notEditableReason: "AD_GROUPS",
    });
    expect(details.targeting).toEqual({ locations: [], languages: [] });
    expect(details.keywords).toEqual([]);
    expect(details.ad).toBeNull();
    expect(details.sitelinks).toEqual([]);
    expect(details.callouts).toEqual([]);
    // No locations and no images: those lookups are skipped.
    expect(queries().some((q) => q.includes("FROM geo_target_constant"))).toBe(
      false,
    );
    expect(queries().some((q) => q.includes("FROM asset WHERE"))).toBe(false);
  });

  it("treats Google's far-future end date as no end date", async () => {
    mockResults({
      campaign: [campaignRow({ endDateTime: "2037-12-30 23:59:59" })],
    });
    expect(
      (await getGoogleCampaignDetails(detailsInput)).campaign.endDate,
    ).toBeNull();
  });

  it("returns 404 for an unknown or removed campaign", async () => {
    mockResults({ campaign: [] });
    await expect(getGoogleCampaignDetails(detailsInput)).rejects.toMatchObject({
      status: 404,
    });
    expect(deleteSessionMock).toHaveBeenCalled();
  });

  it("returns 404 without a query for an id that is not digits", async () => {
    await expect(
      getGoogleCampaignDetails({ ...detailsInput, campaignId: "1 OR 1=1" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(executeToolMock).not.toHaveBeenCalled();
  });

  it.each([
    ["PAUSED", null, "PAUSED"],
    ["ENABLED", "SERVING", "ACTIVE"],
    ["ENABLED", "ENDED", "ENDED"],
    ["UNKNOWN", null, "OTHER"],
  ])(
    "maps Google status %s (serving %s) to %s like the list",
    async (google, serving, status) => {
      mockResults({
        campaign: [campaignRow({ status: google, servingStatus: serving })],
      });
      expect(
        (await getGoogleCampaignDetails(detailsInput)).campaign.status,
      ).toBe(status);
    },
  );

  it("skips a keyword whose match type it does not know", async () => {
    mockResults({
      keywords: [
        ...base.keywords!,
        {
          adGroupCriterion: {
            criterionId: "12",
            keyword: { text: "shoes", matchType: "UNKNOWN" },
            status: "ENABLED",
          },
        },
      ],
    });
    expect(
      (await getGoogleCampaignDetails(detailsInput)).keywords.map(
        ({ id }) => id,
      ),
    ).toEqual(["11"]);
  });

  describe("editable shape", () => {
    const secondAd = {
      ...rsa,
      adGroupAd: { ...rsa.adGroupAd, ad: { ...rsa.adGroupAd.ad, id: "2" } },
    };
    const display = campaignRow({ advertisingChannelType: "DISPLAY" });

    it.each([
      [
        "a type other than Search and Display",
        { campaign: [campaignRow({ advertisingChannelType: "SHOPPING" })] },
        { type: "OTHER", reason: "TYPE" },
      ],
      [
        "TYPE before AD_GROUPS",
        {
          campaign: [campaignRow({ advertisingChannelType: "VIDEO" })],
          adGroups: [],
        },
        { type: "OTHER", reason: "TYPE" },
      ],
      [
        "two ad groups",
        {
          adGroups: [
            { adGroup: { id: "7", status: "ENABLED" } },
            { adGroup: { id: "8", status: "PAUSED" } },
          ],
        },
        { type: "SEARCH", reason: "AD_GROUPS" },
      ],
      [
        "two ads",
        { ads: [rsa, secondAd] },
        { type: "SEARCH", reason: "AD_TYPE" },
      ],
      ["no ad", { ads: [] }, { type: "SEARCH", reason: "AD_TYPE" }],
      [
        "an ad of the wrong type for the campaign",
        { campaign: [display], ads: [rsa] },
        { type: "DISPLAY", reason: "AD_TYPE" },
      ],
      [
        "an ad of another type",
        {
          ads: [
            {
              ...rsa,
              adGroupAd: {
                ...rsa.adGroupAd,
                ad: { id: "5", type: "EXPANDED_TEXT_AD", finalUrls: [] },
              },
            },
          ],
        },
        { type: "SEARCH", reason: "AD_TYPE" },
      ],
    ])(
      "is not editable with %s",
      async (_name, overrides: Record<string, unknown[]>, expected) => {
        mockResults(overrides);
        const { campaign, ad } = await getGoogleCampaignDetails(detailsInput);
        expect(campaign).toMatchObject({
          type: expected.type,
          editable: false,
          notEditableReason: expected.reason,
        });
        // Only a campaign with exactly one ad exposes it.
        if ((overrides.ads ?? base.ads).length !== 1) expect(ad).toBeNull();
      },
    );

    it("keeps an ad of another type without search or display content", async () => {
      mockResults({
        ads: [
          {
            ...rsa,
            adGroupAd: {
              ...rsa.adGroupAd,
              ad: { id: "5", type: "EXPANDED_TEXT_AD", finalUrls: [] },
            },
          },
        ],
      });
      expect((await getGoogleCampaignDetails(detailsInput)).ad).toEqual({
        id: "5",
        status: "ENABLED",
        approvalStatus: "APPROVED",
        reviewStatus: "REVIEWED",
        adStrength: "GOOD",
        finalUrl: "",
      });
    });
  });

  describe("performance", () => {
    it("zero-fills the 7 days before today, oldest first, and totals them", async () => {
      mockResults({
        daily: [
          {
            segments: { date: "2026-10-13" },
            metrics: {
              costMicros: "5000000",
              impressions: "100",
              clicks: "10",
              conversions: 0,
            },
          },
          {
            segments: { date: "2026-10-12" },
            metrics: {
              costMicros: "10000000",
              impressions: "400",
              clicks: "20",
              conversions: 1.5,
            },
          },
        ],
      });
      const { performance } = await getGoogleCampaignDetails(detailsInput);
      expect(performance.daily.map((day) => day.date)).toEqual([
        "2026-10-07",
        "2026-10-08",
        "2026-10-09",
        "2026-10-10",
        "2026-10-11",
        "2026-10-12",
        "2026-10-13",
      ]);
      expect(performance.daily[0]).toEqual({
        date: "2026-10-07",
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
      });
      expect(performance.daily[5]).toEqual({
        date: "2026-10-12",
        spend: 10,
        impressions: 400,
        clicks: 20,
        conversions: 1.5,
      });
      expect(performance.totals).toEqual({
        spend: 15,
        impressions: 500,
        clicks: 30,
        ctr: 0.06,
        cpc: 0.5,
        conversions: 1.5,
      });
    });

    it("has null ctr and cpc without traffic", async () => {
      mockResults({ daily: [] });
      expect(
        (await getGoogleCampaignDetails(detailsInput)).performance.totals,
      ).toEqual({
        spend: 0,
        impressions: 0,
        clicks: 0,
        ctr: null,
        cpc: null,
        conversions: 0,
      });
    });

    it("covers 30 days for LAST_30_DAYS and queries that range", async () => {
      const { performance } = await getGoogleCampaignDetails({
        ...detailsInput,
        range: "LAST_30_DAYS",
      });
      expect(performance.daily).toHaveLength(30);
      expect(performance.daily[0]?.date).toBe("2026-09-14");
      expect(performance.daily[29]?.date).toBe("2026-10-13");
      expect(
        queries().some((q) => q.includes("segments.date DURING LAST_30_DAYS")),
      ).toBe(true);
    });

    it("counts days in the customer's time zone", async () => {
      // 03:00 UTC: still Oct 13 in Los Angeles, already Oct 14 in Berlin.
      vi.setSystemTime(new Date("2026-10-14T03:00:00.000Z"));
      mockResults({
        campaign: [
          {
            ...campaignRow({ startDateTime: "2026-10-14 00:00:00" }),
            customer: { timeZone: "America/Los_Angeles" },
          },
        ],
      });
      const la = await getGoogleCampaignDetails(detailsInput);
      expect(la.campaign.started).toBe(false);
      expect(la.performance.daily.at(-1)?.date).toBe("2026-10-12");

      mockResults({
        campaign: [campaignRow({ startDateTime: "2026-10-14 00:00:00" })],
      });
      const berlin = await getGoogleCampaignDetails(detailsInput);
      expect(berlin.campaign.started).toBe(true);
      expect(berlin.performance.daily.at(-1)?.date).toBe("2026-10-13");
    });
  });

  it("queries only this campaign, in one session, without removed resources", async () => {
    mockResults({ images: [] });
    await getGoogleCampaignDetails(detailsInput);
    const all = queries();
    expect(all).toHaveLength(8);
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolkitSlug: "googleads",
        toolSlugs: ["GOOGLEADS_SEARCH_STREAM_GAQL"],
      }),
    );
    for (const call of executeToolMock.mock.calls.map(([c]) => c)) {
      expect(call.toolSlug).toBe("GOOGLEADS_SEARCH_STREAM_GAQL");
      expect(call.arguments.customer_id).toBe("111");
    }
    expect(all.filter((q) => q.includes("campaign.id = 42"))).toHaveLength(6);
    expect(all.find((q) => q.includes("FROM campaign_asset"))).toContain(
      "campaign_asset.campaign = 'customers/111/campaigns/42'",
    );
    for (const from of ["FROM ad_group_criterion", "FROM ad_group_ad"]) {
      expect(all.find((q) => q.includes(from))).toContain(
        "ad_group.status != 'REMOVED'",
      );
    }
    expect(all.find((q) => q.includes("FROM geo_target_constant"))).toContain(
      "geo_target_constant.resource_name IN ('geoTargetConstants/2276')",
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
    await expect(getGoogleCampaignDetails(detailsInput)).rejects.toBeInstanceOf(
      ComposioToolError,
    );
    expect(deleteSessionMock).toHaveBeenCalled();
  });

  it("raises a row that does not match the expected shape", async () => {
    mockResults({ keywords: [{ adGroupCriterion: {} }] });
    await expect(getGoogleCampaignDetails(detailsInput)).rejects.toThrow(
      /invalid response/,
    );
  });
});

describe("editGoogleCampaign", () => {
  const BLOB = "https://store.public.blob.vercel-storage.com/drive/users/u1";
  const driveImage = (name: string, role: "LANDSCAPE" | "SQUARE" | "LOGO") => ({
    pathname: `drive/users/u1/${name}`,
    fileUrl: `${BLOB}/${name}`,
    name,
    size: 3,
    mimeType: "image/png" as const,
    role,
  });
  // The state of `base`: what an unchanged request repeats.
  const search = {
    type: "SEARCH" as const,
    startDate: "2026-10-01",
    endDate: "2026-12-31",
    locationIds: ["2276"],
    languageIds: ["1001"],
    finalUrl: "https://example.com",
    keywords: [{ text: "running shoes", matchType: "EXACT" as const }],
    headlines: ["Buy shoes", "Run fast"],
    descriptions: ["Free shipping"],
    path1: "shoes",
    sitelinks: [
      {
        text: "Sale",
        finalUrl: "https://example.com/sale",
        description1: "Up to 50%",
      },
    ],
    callouts: ["Free returns"],
  };
  const edit = {
    ...input,
    customerId: "111",
    campaignId: "42",
    name: "Brand search",
    dailyBudget: 12.5,
    google: search,
  };
  const withGoogle = (google: Record<string, unknown>) => ({
    ...edit,
    google: { ...search, ...google },
  });

  // Display state: the 404 image of `rda` is left out so the ad has 1, 2 and 3.
  const displayAd = {
    adGroupAd: {
      ...rda.adGroupAd,
      ad: {
        ...rda.adGroupAd.ad,
        responsiveDisplayAd: {
          ...rda.adGroupAd.ad.responsiveDisplayAd,
          marketingImages: [{ asset: "customers/111/assets/1" }],
        },
      },
    },
    adGroup: { id: "7" },
  };
  const displayState = {
    campaign: [campaignRow({ advertisingChannelType: "DISPLAY" })],
    ads: [displayAd],
    keywords: [],
    assets: [],
    images: [
      imageAsset(1, 1200, 628),
      imageAsset(2, 600, 600),
      imageAsset(3, 128, 128),
    ],
  };
  const display = {
    type: "DISPLAY" as const,
    startDate: "2026-10-01",
    endDate: "2026-12-31",
    locationIds: ["2276"],
    languageIds: ["1001"],
    finalUrl: "https://example.com/display",
    businessName: "Acme",
    headlines: ["Shoes"],
    longHeadline: "The best running shoes",
    descriptions: ["Fast"],
    images: [
      { assetId: "1", role: "LANDSCAPE" as const },
      { assetId: "2", role: "SQUARE" as const },
      { assetId: "3", role: "LOGO" as const },
    ],
  };
  const displayEdit = (google: Record<string, unknown> = {}) => ({
    ...edit,
    google: { ...display, ...google },
  });

  let assetId = 100;
  const applied = (call: { arguments: { mutate_operations: object[] } }) =>
    "asset_operation" in (call.arguments.mutate_operations[0] ?? {})
      ? {
          mutate_operation_responses: [
            {
              asset_result: {
                resource_name: `customers/111/assets/${assetId++}`,
              },
            },
          ],
        }
      : {
          mutate_operation_responses: [
            {
              campaign_result: { resource_name: "customers/111/campaigns/42" },
            },
          ],
        };
  const batches = () =>
    executeToolMock.mock.calls
      .map(([call]) => call)
      .filter((call) => call.toolSlug === "GOOGLEADS_BATCH_MUTATE");
  /** The operations of the last BATCH_MUTATE call. */
  const sent = () =>
    batches().at(-1)?.arguments.mutate_operations as Record<string, unknown>[];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.setSystemTime(new Date("2026-10-14T10:00:00.000Z"));
    assetId = 100;
    createSessionMock.mockResolvedValue("sess_1");
    mockResults({}, applied);
    ssrfSafeFetchMock.mockImplementation(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the campaign without metrics and sends nothing when nothing changed", async () => {
    await expect(editGoogleCampaign(edit)).resolves.toBeUndefined();
    expect(batches()).toEqual([]);
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolSlugs: ["GOOGLEADS_SEARCH_STREAM_GAQL", "GOOGLEADS_BATCH_MUTATE"],
      }),
    );
    const queries = executeToolMock.mock.calls.map(
      ([call]) => call.arguments.query as string,
    );
    expect(queries.some((query) => query.includes("segments.date"))).toBe(
      false,
    );
    expect(deleteSessionMock).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for a campaign without end date and a request without one", async () => {
    mockResults(
      {
        campaign: [campaignRow({ endDateTime: "2037-12-30 23:59:59" })],
      },
      applied,
    );
    await editGoogleCampaign(withGoogle({ endDate: undefined }));
    expect(batches()).toEqual([]);
  });

  it("updates name and budget with masks of the changed fields only, in one atomic call", async () => {
    await editGoogleCampaign({
      ...edit,
      name: "New name",
      dailyBudget: 20.25,
    });
    expect(batches()).toHaveLength(1);
    expect(batches()[0]?.arguments).toMatchObject({
      customer_id: "111",
      partial_failure: false,
    });
    expect(sent()).toEqual([
      {
        campaign_budget_operation: {
          update: {
            resource_name: "customers/111/campaignBudgets/7",
            amount_micros: 20_250_000,
          },
          update_mask: "amountMicros",
        },
      },
      {
        campaign_operation: {
          update: {
            resource_name: "customers/111/campaigns/42",
            name: "New name",
          },
          update_mask: "name",
        },
      },
    ]);
  });

  it("changes the dates of a campaign that has not started", async () => {
    mockResults(
      { campaign: [campaignRow({ startDateTime: "2026-11-01 00:00:00" })] },
      applied,
    );
    await editGoogleCampaign(
      withGoogle({ startDate: "2026-11-05", endDate: "2027-01-31" }),
    );
    expect(sent()).toEqual([
      {
        campaign_operation: {
          update: {
            resource_name: "customers/111/campaigns/42",
            start_date_time: "2026-11-05 00:00:00",
            end_date_time: "2027-01-31 23:59:59",
          },
          update_mask: "startDateTime,endDateTime",
        },
      },
    ]);
  });

  it("removes the end date by sending Google's far-future date", async () => {
    await editGoogleCampaign(withGoogle({ endDate: undefined }));
    expect(sent()).toEqual([
      {
        campaign_operation: {
          update: {
            resource_name: "customers/111/campaigns/42",
            end_date_time: "2037-12-30 23:59:59",
          },
          update_mask: "endDateTime",
        },
      },
    ]);
  });

  it("keeps the start date of a started campaign when the request omits it", async () => {
    await editGoogleCampaign(withGoogle({ startDate: undefined }));
    expect(batches()).toEqual([]);
  });

  it("keeps the start date of a campaign that has not started when the request omits it", async () => {
    mockResults(
      { campaign: [campaignRow({ startDateTime: "2026-11-01 00:00:00" })] },
      applied,
    );
    await editGoogleCampaign(
      withGoogle({ startDate: undefined, endDate: "2027-01-31" }),
    );
    expect(sent()).toEqual([
      {
        campaign_operation: {
          update: {
            resource_name: "customers/111/campaigns/42",
            end_date_time: "2027-01-31 23:59:59",
          },
          update_mask: "endDateTime",
        },
      },
    ]);
  });

  describe("refusals before any write", () => {
    const refused = async (
      request: Parameters<typeof editGoogleCampaign>[0],
      expected: Record<string, unknown>,
    ) => {
      await expect(editGoogleCampaign(request)).rejects.toMatchObject(expected);
      expect(batches()).toEqual([]);
      expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
      expect(deleteSessionMock).toHaveBeenCalled();
    };

    it("returns 422 for a start date change after the campaign started", async () => {
      await refused(withGoogle({ startDate: "2026-10-02" }), {
        status: 422,
        message: "The start date can't change after the campaign started",
      });
    });

    it("returns 422 when the request type differs from the campaign type", async () => {
      await refused(displayEdit(), {
        status: 422,
        message: "The campaign type can't change",
      });
    });

    it.each([
      [
        "two ad groups",
        {
          adGroups: [
            { adGroup: { id: "7", status: "ENABLED" } },
            { adGroup: { id: "8", status: "PAUSED" } },
          ],
        },
      ],
      [
        "an unsupported campaign type",
        {
          campaign: [campaignRow({ advertisingChannelType: "SHOPPING" })],
        },
      ],
      ["no ad", { ads: [] }],
    ])("returns 409 for a campaign with %s", async (_name, overrides) => {
      mockResults(overrides, applied);
      await refused(edit, {
        status: 409,
        message: "Campaign can't be edited here",
      });
    });

    it("returns 404 for an unknown or removed campaign", async () => {
      mockResults({ campaign: [] }, applied);
      await refused(edit, { status: 404 });
    });

    it("returns 404 without a call for an id that is not digits", async () => {
      await expect(
        editGoogleCampaign({ ...edit, campaignId: "1 OR 1=1" }),
      ).rejects.toMatchObject({ status: 404 });
      expect(createSessionMock).not.toHaveBeenCalled();
    });

    it("returns 422 for a budget change on a shared budget", async () => {
      mockResults(
        {
          campaign: [
            {
              ...campaignRow(),
              campaignBudget: {
                amountMicros: "12500000",
                explicitlyShared: true,
              },
            },
          ],
        },
        applied,
      );
      await refused(
        { ...edit, dailyBudget: 30 },
        {
          status: 422,
          message:
            "This campaign uses a shared budget; change it in Google Ads",
        },
      );
    });

    it("returns 422 for a kept image that is not in the ad", async () => {
      mockResults(displayState, applied);
      await refused(
        displayEdit({
          images: [
            ...display.images,
            { assetId: "999", role: "SQUARE" as const },
          ],
        }),
        { status: 422, message: expect.stringContaining("999") },
      );
    });
  });

  it("removes and adds locations and languages, once each, removals first", async () => {
    await editGoogleCampaign(
      withGoogle({
        locationIds: ["2840", "2840"],
        languageIds: ["1002"],
      }),
    );
    expect(sent()).toEqual([
      {
        campaign_criterion_operation: {
          remove: "customers/111/campaignCriteria/42~21",
        },
      },
      {
        campaign_criterion_operation: {
          remove: "customers/111/campaignCriteria/42~22",
        },
      },
      {
        campaign_criterion_operation: {
          create: {
            campaign: "customers/111/campaigns/42",
            location: { geo_target_constant: "geoTargetConstants/2840" },
          },
        },
      },
      {
        campaign_criterion_operation: {
          create: {
            campaign: "customers/111/campaigns/42",
            language: { language_constant: "languageConstants/1002" },
          },
        },
      },
    ]);
  });

  it("keeps the targeting that the request repeats", async () => {
    await editGoogleCampaign(withGoogle({ locationIds: ["2276", "2840"] }));
    expect(sent()).toEqual([
      {
        campaign_criterion_operation: {
          create: {
            campaign: "customers/111/campaigns/42",
            location: { geo_target_constant: "geoTargetConstants/2840" },
          },
        },
      },
    ]);
  });

  it("adds and removes keywords, matching ignoring case and dropping repeats", async () => {
    mockResults(
      {
        keywords: [
          ...base.keywords,
          {
            adGroupCriterion: {
              criterionId: "12",
              keyword: { text: "cheap shoes", matchType: "BROAD" },
              status: "ENABLED",
            },
          },
        ],
      },
      applied,
    );
    await editGoogleCampaign(
      withGoogle({
        keywords: [
          { text: "Running Shoes", matchType: "EXACT" },
          { text: "trail shoes", matchType: "PHRASE" },
          { text: "Trail Shoes", matchType: "PHRASE" },
          { text: "trail shoes", matchType: "BROAD" },
        ],
      }),
    );
    expect(sent()).toEqual([
      {
        ad_group_criterion_operation: {
          remove: "customers/111/adGroupCriteria/7~12",
        },
      },
      {
        ad_group_criterion_operation: {
          create: {
            ad_group: "customers/111/adGroups/7",
            status: "ENABLED",
            keyword: { text: "trail shoes", match_type: "PHRASE" },
          },
        },
      },
      {
        ad_group_criterion_operation: {
          create: {
            ad_group: "customers/111/adGroups/7",
            status: "ENABLED",
            keyword: { text: "trail shoes", match_type: "BROAD" },
          },
        },
      },
    ]);
  });

  describe("the ad", () => {
    it("updates the changed search ad fields with a mask of them", async () => {
      await editGoogleCampaign(
        withGoogle({
          finalUrl: "https://example.com/new",
          headlines: ["Buy shoes", "Run fast", "Free returns"],
        }),
      );
      expect(sent()).toEqual([
        {
          ad_operation: {
            update: {
              resource_name: "customers/111/ads/900",
              final_urls: ["https://example.com/new"],
              responsive_search_ad: {
                headlines: [
                  { text: "Buy shoes" },
                  { text: "Run fast" },
                  { text: "Free returns" },
                ],
              },
            },
            update_mask: "finalUrls,responsiveSearchAd.headlines",
          },
        },
      ]);
    });

    it("changes descriptions and paths, and clears a removed path", async () => {
      await editGoogleCampaign(
        withGoogle({
          descriptions: ["Free shipping", "Order today"],
          path1: undefined,
          path2: undefined,
        }),
      );
      expect(sent()).toEqual([
        {
          ad_operation: {
            update: {
              resource_name: "customers/111/ads/900",
              responsive_search_ad: {
                descriptions: [
                  { text: "Free shipping" },
                  { text: "Order today" },
                ],
              },
            },
            update_mask:
              "responsiveSearchAd.descriptions,responsiveSearchAd.path1",
          },
        },
      ]);
    });

    it("replaces the changed display ad fields", async () => {
      mockResults(displayState, applied);
      await editGoogleCampaign(
        displayEdit({
          businessName: "Acme Shoes",
          longHeadline: "Even better shoes",
          headlines: ["Shoes", "More shoes"],
          descriptions: ["Faster"],
        }),
      );
      expect(sent()).toEqual([
        {
          ad_operation: {
            update: {
              resource_name: "customers/111/ads/901",
              responsive_display_ad: {
                headlines: [{ text: "Shoes" }, { text: "More shoes" }],
                long_headline: { text: "Even better shoes" },
                descriptions: [{ text: "Faster" }],
                business_name: "Acme Shoes",
              },
            },
            update_mask:
              "responsiveDisplayAd.headlines,responsiveDisplayAd.longHeadline,responsiveDisplayAd.descriptions,responsiveDisplayAd.businessName",
          },
        },
      ]);
    });

    it("keeps old images, uploads new ones first and sends the new image lists", async () => {
      mockResults(displayState, applied);
      await editGoogleCampaign(
        displayEdit({
          images: [
            { assetId: "1", role: "LANDSCAPE" },
            driveImage("wide2.png", "LANDSCAPE"),
            { assetId: "2", role: "SQUARE" },
          ],
        }),
      );
      expect(ssrfSafeFetchMock.mock.calls.map(([url]) => url)).toEqual([
        `${BLOB}/wide2.png`,
      ]);
      expect(batches()).toHaveLength(2);
      expect(batches()[0]?.arguments.mutate_operations).toEqual([
        {
          asset_operation: {
            create: {
              name: expect.stringMatching(/^wide2\.png [0-9a-f]{8}$/),
              type: "IMAGE",
              image_asset: { data: "AQID" },
            },
          },
        },
      ]);
      expect(sent()).toEqual([
        {
          ad_operation: {
            update: {
              resource_name: "customers/111/ads/901",
              responsive_display_ad: {
                marketing_images: [
                  { asset: "customers/111/assets/1" },
                  { asset: "customers/111/assets/100" },
                ],
                square_logo_images: [],
              },
            },
            update_mask:
              "responsiveDisplayAd.marketingImages,responsiveDisplayAd.squareLogoImages",
          },
        },
      ]);
    });

    it("sends nothing for a display ad whose kept images are unchanged", async () => {
      mockResults(displayState, applied);
      await editGoogleCampaign(displayEdit());
      expect(batches()).toEqual([]);
    });
  });

  describe("sitelinks and callouts", () => {
    const link = (assetId: number) => ({
      campaign_asset_operation: {
        create: {
          campaign: "customers/111/campaigns/42",
          asset: `customers/111/assets/${assetId}`,
          field_type: "SITELINK",
        },
      },
    });

    it("leaves unchanged ones alone", async () => {
      await editGoogleCampaign(withGoogle({}));
      expect(batches()).toEqual([]);
    });

    it("unlinks the ones the request drops, without removing assets", async () => {
      await editGoogleCampaign(
        withGoogle({ sitelinks: undefined, callouts: [] }),
      );
      expect(sent()).toEqual([
        {
          campaign_asset_operation: {
            remove: "customers/111/campaignAssets/42~50~SITELINK",
          },
        },
        {
          campaign_asset_operation: {
            remove: "customers/111/campaignAssets/42~51~CALLOUT",
          },
        },
      ]);
    });

    it("replaces a changed one and adds a new one: assets before their links, unlinks first", async () => {
      await editGoogleCampaign(
        withGoogle({
          sitelinks: [
            {
              text: "Sale",
              finalUrl: "https://example.com/sale-2",
              description1: "Up to 50%",
            },
            { text: "About", finalUrl: "https://example.com/about" },
          ],
          callouts: ["free returns", "24/7 support"],
        }),
      );
      expect(sent()).toEqual([
        {
          campaign_asset_operation: {
            remove: "customers/111/campaignAssets/42~50~SITELINK",
          },
        },
        {
          campaign_asset_operation: {
            remove: "customers/111/campaignAssets/42~51~CALLOUT",
          },
        },
        {
          asset_operation: {
            create: {
              resource_name: "customers/111/assets/-10",
              final_urls: ["https://example.com/sale-2"],
              sitelink_asset: { link_text: "Sale", description1: "Up to 50%" },
            },
          },
        },
        {
          asset_operation: {
            create: {
              resource_name: "customers/111/assets/-11",
              final_urls: ["https://example.com/about"],
              sitelink_asset: { link_text: "About" },
            },
          },
        },
        {
          asset_operation: {
            create: {
              resource_name: "customers/111/assets/-12",
              callout_asset: { callout_text: "free returns" },
            },
          },
        },
        {
          asset_operation: {
            create: {
              resource_name: "customers/111/assets/-13",
              callout_asset: { callout_text: "24/7 support" },
            },
          },
        },
        link(-10),
        link(-11),
        {
          campaign_asset_operation: {
            create: {
              campaign: "customers/111/campaigns/42",
              asset: "customers/111/assets/-12",
              field_type: "CALLOUT",
            },
          },
        },
        {
          campaign_asset_operation: {
            create: {
              campaign: "customers/111/campaigns/42",
              asset: "customers/111/assets/-13",
              field_type: "CALLOUT",
            },
          },
        },
      ]);
    });
  });

  it("orders removals, updates and creations across resources", async () => {
    await editGoogleCampaign({
      ...withGoogle({ locationIds: ["2840"], headlines: ["A", "B"] }),
      name: "Renamed",
    });
    expect(sent().map((operation) => Object.keys(operation)[0])).toEqual([
      "campaign_criterion_operation",
      "campaign_operation",
      "ad_operation",
      "campaign_criterion_operation",
    ]);
  });

  describe("failures", () => {
    it("raises 422 with Google's message and still deletes the session", async () => {
      mockResults({}, () => {
        throw new ComposioToolError({
          message: "refused",
          providerMessage: failure(
            { stringLengthError: "TOO_LONG" },
            "Too long.",
          ),
        });
      });
      await expect(
        editGoogleCampaign({ ...edit, name: "New" }),
      ).rejects.toMatchObject({ status: 422, message: "Too long." });
      expect(deleteSessionMock).toHaveBeenCalled();
    });

    it("keeps other provider errors unchanged", async () => {
      const error = new ComposioToolError({ message: "refused" });
      mockResults({}, () => {
        throw error;
      });
      await expect(editGoogleCampaign({ ...edit, name: "New" })).rejects.toBe(
        error,
      );
    });

    it.each([
      [
        "a partial failure",
        {
          mutate_operation_responses: [{}],
          partial_failure_error: { code: 3 },
        },
      ],
      ["no results", {}],
    ])("raises a tool error for %s", async (_name, result) => {
      mockResults({}, () => result);
      await expect(
        editGoogleCampaign({ ...edit, name: "New" }),
      ).rejects.toBeInstanceOf(ComposioToolError);
    });

    it("stops at an unreachable Drive image before writing anything", async () => {
      mockResults(displayState, applied);
      ssrfSafeFetchMock.mockResolvedValue(new Response(null, { status: 404 }));
      await expect(
        editGoogleCampaign(
          displayEdit({
            images: [...display.images, driveImage("gone.png", "SQUARE")],
          }),
        ),
      ).rejects.toMatchObject({ status: 422 });
      expect(batches()).toEqual([]);
    });
  });
});
