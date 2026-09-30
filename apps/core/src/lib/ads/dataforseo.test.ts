import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ComposioConfigError } from "@/clients/composio.client";
import { ComposioToolError } from "@/clients/social-post-providers/tools";

const m = vi.hoisted(() => ({
  getEnv: vi.fn(),
  createSession: vi.fn(),
  executeTool: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: m.getEnv }));
vi.mock("@/clients/composio.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/composio.client")>()),
  deleteComposioToolSession: m.deleteSession,
}));
vi.mock("@/clients/social-post-providers/tools", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/clients/social-post-providers/tools")
  >()),
  createComposioToolSession: m.createSession,
  executeComposioTool: m.executeTool,
}));

import { fetchMarketAds, fetchMarketKeywords } from "./dataforseo";

const query = {
  keywords: ["running shoes"],
  locationCode: 2840,
  languageCode: "en",
};

function task(result: unknown, statusCode = 20000, statusMessage = "Ok.") {
  return {
    tasks: [{ status_code: statusCode, status_message: statusMessage, result }],
  };
}

describe("fetchMarketKeywords", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.getEnv.mockReturnValue({
      COMPOSIO_DATAFORSEO_CONNECTED_ACCOUNT_ID: "ca_seo",
    });
    m.createSession.mockResolvedValue("sess_1");
  });

  it("runs the tool as the platform user on the platform connection", async () => {
    m.executeTool.mockResolvedValue(task([]));
    await fetchMarketKeywords(query);
    expect(m.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        toolkitSlug: "dataforseo",
        connectedAccountId: "ca_seo",
        executorUserId: "sokosumi:platform",
        toolSlugs: ["DATAFORSEO_GET_KW_GOOGLE_ADS_KW_FOR_KW_LIVE"],
        context: "create platform DataForSEO session",
      }),
    );
    expect(m.executeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolSlug: "DATAFORSEO_GET_KW_GOOGLE_ADS_KW_FOR_KW_LIVE",
        arguments: {
          keywords: ["running shoes"],
          location_code: 2840,
          language_code: "en",
          sort_by: "search_volume",
        },
      }),
    );
    expect(m.deleteSession).toHaveBeenCalledWith(
      "sess_1",
      "delete platform DataForSEO session",
    );
  });

  it("maps, orders the trend oldest first and sorts by volume with nulls last", async () => {
    m.executeTool.mockResolvedValue(
      task([
        {
          keyword: "no data",
          search_volume: null,
          monthly_searches: null,
          competition: null,
        },
        {
          keyword: "running shoes",
          search_volume: 5400,
          monthly_searches: [
            { year: 2026, month: 8, search_volume: 6000 },
            { year: 2025, month: 12, search_volume: 4000 },
            { year: 2026, month: 1, search_volume: null },
          ],
          competition: "HIGH",
          competition_index: 87,
          cpc: 1.25,
          low_top_of_page_bid: 0.5,
          high_top_of_page_bid: 2.1,
        },
        { keyword: "trail shoes", search_volume: 900, competition: "WEIRD" },
      ]),
    );
    expect(await fetchMarketKeywords(query)).toEqual([
      {
        keyword: "running shoes",
        searchVolume: 5400,
        trend: [
          { year: 2025, month: 12, searchVolume: 4000 },
          { year: 2026, month: 1, searchVolume: null },
          { year: 2026, month: 8, searchVolume: 6000 },
        ],
        competition: "HIGH",
        competitionIndex: 87,
        cpc: 1.25,
        lowTopOfPageBid: 0.5,
        highTopOfPageBid: 2.1,
      },
      {
        keyword: "trail shoes",
        searchVolume: 900,
        trend: [],
        competition: null,
        competitionIndex: null,
        cpc: null,
        lowTopOfPageBid: null,
        highTopOfPageBid: null,
      },
      {
        keyword: "no data",
        searchVolume: null,
        trend: [],
        competition: null,
        competitionIndex: null,
        cpc: null,
        lowTopOfPageBid: null,
        highTopOfPageBid: null,
      },
    ]);
  });

  it("keeps the 12 most recent months, null months included, oldest first", async () => {
    // 2025-09 .. 2026-10, newest first as DataForSEO may return it.
    const months = Array.from({ length: 14 }, (_, i) => ({
      year: 2025 + Math.floor((8 + i) / 12),
      month: ((8 + i) % 12) + 1,
      search_volume: i === 5 ? null : i,
    })).reverse();
    m.executeTool.mockResolvedValue(
      task([{ keyword: "a", search_volume: 1, monthly_searches: months }]),
    );
    const [keyword] = await fetchMarketKeywords(query);
    expect(keyword?.trend).toHaveLength(12);
    expect(keyword?.trend[0]).toEqual({
      year: 2025,
      month: 11,
      searchVolume: 2,
    });
    expect(keyword?.trend[3]).toEqual({
      year: 2026,
      month: 2,
      searchVolume: null,
    });
    expect(keyword?.trend[11]).toEqual({
      year: 2026,
      month: 10,
      searchVolume: 13,
    });
  });

  it("keeps the 50 highest-volume keywords", async () => {
    m.executeTool.mockResolvedValue(
      task(
        Array.from({ length: 60 }, (_, i) => ({
          keyword: `k${i}`,
          search_volume: i,
        })),
      ),
    );
    const keywords = await fetchMarketKeywords(query);
    expect(keywords).toHaveLength(50);
    expect(keywords[0]?.keyword).toBe("k59");
  });

  it("treats a task without results as no keywords", async () => {
    m.executeTool.mockResolvedValue(task(null));
    expect(await fetchMarketKeywords(query)).toEqual([]);
  });

  it("raises a tool error for a DataForSEO task error and still deletes the session", async () => {
    m.executeTool.mockResolvedValue(
      task(null, 40501, "Invalid Field: 'location_code'."),
    );
    await expect(fetchMarketKeywords(query)).rejects.toBeInstanceOf(
      ComposioToolError,
    );
    expect(m.deleteSession).toHaveBeenCalled();
  });

  it("raises a tool error, with DataForSEO's message kept for logs, for a failed envelope", async () => {
    m.executeTool.mockResolvedValue({
      status_code: 40101,
      status_message: "Authentication failed.",
      tasks: [],
    });
    await expect(fetchMarketKeywords(query)).rejects.toMatchObject({
      name: "ComposioToolError",
      providerStatus: 40101,
      providerMessage: "Authentication failed.",
    });
  });

  it("rejects a response without tasks or with a malformed row", async () => {
    m.executeTool.mockResolvedValueOnce({ tasks: [] });
    await expect(fetchMarketKeywords(query)).rejects.toThrow(
      "invalid response",
    );
    m.executeTool.mockResolvedValueOnce(task([{ search_volume: 1 }]));
    await expect(fetchMarketKeywords(query)).rejects.toThrow(
      "invalid response",
    );
  });

  it("raises a configuration error without the platform connection, before any call", async () => {
    m.getEnv.mockReturnValue({});
    await expect(fetchMarketKeywords(query)).rejects.toBeInstanceOf(
      ComposioConfigError,
    );
    expect(m.createSession).not.toHaveBeenCalled();
  });
});

const ADVERTISERS = "DATAFORSEO_GET_SERP_GOOGLE_ADS_ADVERTISERS_LIVE_ADVANCED";
const ADS_SEARCH = "DATAFORSEO_GET_SERP_GOOGLE_ADS_SEARCH_LIVE_ADVANCED";

describe("fetchMarketAds", () => {
  const adsQuery = { keywords: ["running shoes", "trail"], locationCode: 2840 };
  const NOW = new Date("2026-10-01T12:00:00.000Z");

  const advertiser = (id: string, count: number | null, title = id) => ({
    type: "ads_advertiser",
    title,
    advertiser_id: id,
    approx_ads_count: count,
    verified: true,
  });
  /** One advertisers task per keyword, like DataForSEO. */
  const advertiserTasks = (...itemsPerTask: unknown[][]) => ({
    tasks: itemsPerTask.map((items) => ({
      status_code: 20000,
      status_message: "Ok.",
      result: [{ type: "ads_advertiser", items }],
    })),
  });
  const ad = (overrides: Record<string, unknown> = {}) => ({
    type: "ads_search",
    creative_id: "CR1",
    advertiser_id: "AR1",
    title: "Acme Shoes",
    format: "image",
    preview_image: {
      url: "https://tpc.googlesyndication.com/archive/simgad/1",
      width: 300,
      height: 250,
    },
    url: "https://adstransparency.google.com/advertiser/AR1/creative/CR1",
    first_shown: "2026-09-01 08:00:00 +00:00",
    last_shown: "2026-09-30 10:30:00 +00:00",
    verified: true,
    ...overrides,
  });
  const searchTask = (items: unknown[]) =>
    task([{ type: "ads_search", items }]);

  function mockTools(advertisers: unknown, search?: unknown) {
    m.executeTool.mockImplementation(
      async ({ toolSlug }: { toolSlug: string }) =>
        toolSlug === ADVERTISERS ? advertisers : search,
    );
  }
  const callsOf = (slug: string) =>
    m.executeTool.mock.calls.filter(([arg]) => arg.toolSlug === slug);

  beforeEach(() => {
    vi.resetAllMocks();
    m.getEnv.mockReturnValue({
      COMPOSIO_DATAFORSEO_CONNECTED_ACCOUNT_ID: "ca_seo",
    });
    m.createSession.mockResolvedValue("sess_1");
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("runs both tools in one platform session: a task per keyword, then the top advertisers", async () => {
    mockTools(
      advertiserTasks([advertiser("AR1", 5)], [advertiser("AR2", 9)]),
      searchTask([]),
    );
    await fetchMarketAds(adsQuery);
    expect(m.createSession).toHaveBeenCalledTimes(1);
    expect(m.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        toolkitSlug: "dataforseo",
        connectedAccountId: "ca_seo",
        executorUserId: "sokosumi:platform",
        toolSlugs: [ADVERTISERS, ADS_SEARCH],
      }),
    );
    expect(callsOf(ADVERTISERS)).toHaveLength(1);
    expect(callsOf(ADVERTISERS)[0]?.[0].arguments).toEqual({
      tasks: [
        { keyword: "running shoes", location_code: 2840 },
        { keyword: "trail", location_code: 2840 },
      ],
    });
    expect(callsOf(ADS_SEARCH)[0]?.[0].arguments).toEqual({
      advertiser_ids: ["AR2", "AR1"],
      location_code: 2840,
      date_from: "2026-09-01",
      date_to: "2026-10-01",
      depth: 40,
    });
    expect(m.deleteSession).toHaveBeenCalledTimes(1);
  });

  it("truncates keywords to 70 characters", async () => {
    mockTools(advertiserTasks([]), undefined);
    await fetchMarketAds({ keywords: ["a".repeat(80)], locationCode: 2840 });
    expect(callsOf(ADVERTISERS)[0]?.[0].arguments.tasks[0].keyword).toBe(
      "a".repeat(70),
    );
  });

  it("flattens multi-account advertisers, ignores domains, dedupes and ranks by ad count", async () => {
    mockTools(
      advertiserTasks(
        [
          { type: "ads_domain", domain: "acme.com", rank_group: 1 },
          advertiser("AR1", 10),
          {
            type: "ads_multi_account_advertiser",
            title: "Big Brand",
            approx_ads_count: 100,
            advertisers: [
              {
                type: "ads_advertiser",
                advertiser_id: "AR3",
                approx_ads_count: 70,
              },
              {
                type: "ads_advertiser",
                advertiser_id: "AR4",
                approx_ads_count: null,
              },
            ],
          },
        ],
        [advertiser("AR1", 30), advertiser("AR5", 20)],
      ),
      searchTask([]),
    );
    await fetchMarketAds(adsQuery);
    expect(callsOf(ADS_SEARCH)[0]?.[0].arguments.advertiser_ids).toEqual([
      "AR4", // no count of its own: inherits the group's 100
      "AR3",
      "AR1", // 30 in the second keyword beats 10 in the first
      "AR5",
    ]);
  });

  it("asks for the 25 biggest advertisers only", async () => {
    mockTools(
      advertiserTasks(
        Array.from({ length: 30 }, (_, i) => advertiser(`AR${i}`, i)),
      ),
      searchTask([]),
    );
    await fetchMarketAds(adsQuery);
    const ids = callsOf(ADS_SEARCH)[0]?.[0].arguments.advertiser_ids;
    expect(ids).toHaveLength(25);
    expect(ids[0]).toBe("AR29");
    expect(ids).not.toContain("AR0");
  });

  it("returns no ads without searching when no advertiser is found", async () => {
    mockTools(
      advertiserTasks([{ type: "ads_domain", domain: "acme.com" }], []),
    );
    expect(await fetchMarketAds(adsQuery)).toEqual([]);
    expect(callsOf(ADS_SEARCH)).toHaveLength(0);
    expect(m.deleteSession).toHaveBeenCalled();
  });

  it("treats advertiser tasks without results as no advertisers", async () => {
    mockTools({ tasks: [{ status_code: 20000, result: null }] });
    expect(await fetchMarketAds(adsQuery)).toEqual([]);
  });

  it("maps ads, dedupes by creative, sorts by last shown and drops non-https links", async () => {
    mockTools(
      advertiserTasks([advertiser("AR1", 5)]),
      searchTask([
        ad({ creative_id: "OLD", last_shown: "2026-09-10 00:00:00 +00:00" }),
        ad({ creative_id: "CR1" }),
        ad({ creative_id: "CR1", last_shown: "2026-01-01 00:00:00 +00:00" }),
        ad({
          creative_id: "TXT",
          format: "text",
          preview_image: null,
          url: "http://insecure.example/ad",
          last_shown: "2026-09-29 00:00:00 +00:00",
        }),
        ad({
          creative_id: "VID",
          format: "video",
          preview_image: {
            url: "http://insecure.example/a.png",
            width: 1,
            height: 1,
          },
          last_shown: "2026-09-28 00:00:00 +00:00",
        }),
        ad({
          creative_id: "ODD",
          format: "carousel",
          preview_image: undefined,
          last_shown: "2026-09-27 00:00:00 +00:00",
        }),
      ]),
    );
    const ads = await fetchMarketAds(adsQuery);
    expect(ads.map((a) => a.creativeId)).toEqual([
      "CR1",
      "TXT",
      "VID",
      "ODD",
      "OLD",
    ]);
    expect(ads[0]).toEqual({
      creativeId: "CR1",
      advertiserId: "AR1",
      advertiserName: "Acme Shoes",
      format: "image",
      previewImage: {
        url: "https://tpc.googlesyndication.com/archive/simgad/1",
        width: 300,
        height: 250,
      },
      previewUrl:
        "https://adstransparency.google.com/advertiser/AR1/creative/CR1",
      firstShown: "2026-09-01T08:00:00.000Z",
      lastShown: "2026-09-30T10:30:00.000Z",
      verified: true,
    });
    expect(ads[1]).toMatchObject({
      format: "text",
      previewImage: null,
      previewUrl: null,
    });
    expect(ads[2]).toMatchObject({ format: "video", previewImage: null });
    expect(ads[3]).toMatchObject({ format: "other", previewImage: null });
  });

  it("keeps at most 40 ads", async () => {
    mockTools(
      advertiserTasks([advertiser("AR1", 5)]),
      searchTask(
        Array.from({ length: 50 }, (_, i) =>
          ad({
            creative_id: `C${i}`,
            last_shown: `2026-09-${String(i < 30 ? i + 1 : 30).padStart(2, "0")} 00:00:00 +00:00`,
          }),
        ),
      ),
    );
    expect(await fetchMarketAds(adsQuery)).toHaveLength(40);
  });

  it("treats an ads search without results as no ads", async () => {
    mockTools(advertiserTasks([advertiser("AR1", 5)]), task(null));
    expect(await fetchMarketAds(adsQuery)).toEqual([]);
  });

  it("raises a tool error for a failed advertisers task and never searches", async () => {
    mockTools({
      tasks: [
        { status_code: 20000, result: [] },
        { status_code: 40501, status_message: "Invalid Field.", result: null },
      ],
    });
    await expect(fetchMarketAds(adsQuery)).rejects.toMatchObject({
      name: "ComposioToolError",
      providerStatus: 40501,
    });
    expect(callsOf(ADS_SEARCH)).toHaveLength(0);
    expect(m.deleteSession).toHaveBeenCalled();
  });

  it("raises a tool error for a failed ads search task or envelope", async () => {
    mockTools(
      advertiserTasks([advertiser("AR1", 5)]),
      task(null, 50000, "Internal Error."),
    );
    await expect(fetchMarketAds(adsQuery)).rejects.toBeInstanceOf(
      ComposioToolError,
    );
    mockTools(advertiserTasks([advertiser("AR1", 5)]), {
      status_code: 40101,
      status_message: "Authentication failed.",
      tasks: [],
    });
    await expect(fetchMarketAds(adsQuery)).rejects.toMatchObject({
      providerStatus: 40101,
    });
  });

  it("rejects a malformed advertiser or ad", async () => {
    mockTools(advertiserTasks([{ type: "ads_advertiser", title: "no id" }]));
    await expect(fetchMarketAds(adsQuery)).rejects.toThrow("invalid response");
    mockTools(
      advertiserTasks([advertiser("AR1", 5)]),
      searchTask([{ type: "ads_search", title: "no ids" }]),
    );
    await expect(fetchMarketAds(adsQuery)).rejects.toThrow("invalid response");
  });

  it("raises a configuration error without the platform connection, before any call", async () => {
    m.getEnv.mockReturnValue({});
    await expect(fetchMarketAds(adsQuery)).rejects.toBeInstanceOf(
      ComposioConfigError,
    );
    expect(m.createSession).not.toHaveBeenCalled();
  });
});
