import { beforeEach, describe, expect, it, vi } from "vitest";

import { ComposioConfigError } from "@/clients/composio.client";
import { ComposioToolError } from "@/clients/social-post-providers/tools";

const m = vi.hoisted(() => ({
  getEnv: vi.fn(),
  composioFetch: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: m.getEnv }));
vi.mock("@/clients/composio.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/composio.client")>()),
  projectComposioFetch: m.composioFetch,
}));

import {
  competitorAds,
  fetchMarketKeywords,
  getTaskResult,
  mergeMarketAds,
  organicRanks,
  postAdsSearchTasks,
  postSerpTasks,
  rankCompetitorDomains,
} from "./dataforseo";

const PROXY = "/api/v3/tools/execute/proxy";
const API = "https://api.dataforseo.com/v3";

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

/** Composio's proxy wraps DataForSEO's body as `data`. */
function proxied(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data, status, headers: {} }));
}

interface ProxyRequest {
  endpoint: string;
  method: string;
  connected_account_id: string;
  body?: Record<string, unknown>[];
}
const requests = (): ProxyRequest[] =>
  m.composioFetch.mock.calls.map(([, init]) => init.jsonBody);

describe("fetchMarketKeywords", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.getEnv.mockReturnValue({
      COMPOSIO_DATAFORSEO_CONNECTED_ACCOUNT_ID: "ca_seo",
    });
  });

  function mockDataForSeo(data: unknown) {
    m.composioFetch.mockImplementation(async () => proxied(data));
  }

  it("posts one task through the Composio proxy on the platform connection", async () => {
    mockDataForSeo(task([]));
    await fetchMarketKeywords(query);
    expect(m.composioFetch).toHaveBeenCalledWith(PROXY, {
      method: "POST",
      jsonBody: {
        endpoint: `${API}/keywords_data/google_ads/keywords_for_keywords/live`,
        method: "POST",
        connected_account_id: "ca_seo",
        body: [
          {
            keywords: ["running shoes"],
            location_code: 2840,
            language_code: "en",
            sort_by: "search_volume",
          },
        ],
      },
      timeoutMs: 60_000,
    });
  });

  it("maps, orders the trend oldest first and sorts by volume with nulls last", async () => {
    mockDataForSeo(
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
    mockDataForSeo(
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
    mockDataForSeo(
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
    mockDataForSeo(task(null));
    expect(await fetchMarketKeywords(query)).toEqual([]);
  });

  it("raises a tool error for a DataForSEO task error", async () => {
    mockDataForSeo(task(null, 40501, "Invalid Field: 'location_code'."));
    await expect(fetchMarketKeywords(query)).rejects.toBeInstanceOf(
      ComposioToolError,
    );
  });

  it("raises a tool error, with DataForSEO's message kept for logs, for a failed envelope", async () => {
    mockDataForSeo({
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
    mockDataForSeo({ tasks: [] });
    await expect(fetchMarketKeywords(query)).rejects.toThrow(
      "invalid response",
    );
    mockDataForSeo(task([{ search_volume: 1 }]));
    await expect(fetchMarketKeywords(query)).rejects.toThrow(
      "invalid response",
    );
  });

  it("raises a configuration error without the platform connection, before any call", async () => {
    m.getEnv.mockReturnValue({});
    await expect(fetchMarketKeywords(query)).rejects.toBeInstanceOf(
      ComposioConfigError,
    );
    expect(m.composioFetch).not.toHaveBeenCalled();
  });

  it("rejects a proxy response without a DataForSEO body", async () => {
    m.composioFetch.mockResolvedValue(
      new Response(JSON.stringify({ status: 502 })),
    );
    await expect(fetchMarketKeywords(query)).rejects.toThrow(
      "invalid response",
    );
  });
});

describe("queued tasks", () => {
  const NOW = new Date("2026-10-01T12:00:00.000Z");

  /** task_post answers one task per request task, ids t1, t2, ... */
  function created(count: number) {
    return {
      status_code: 20000,
      tasks: Array.from({ length: count }, (_, i) => ({
        id: `t${i + 1}`,
        status_code: 20100,
        status_message: "Task Created.",
        result: null,
      })),
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    m.getEnv.mockReturnValue({
      COMPOSIO_DATAFORSEO_CONNECTED_ACCOUNT_ID: "ca_seo",
    });
  });

  function mockDataForSeo(data: unknown) {
    m.composioFetch.mockImplementation(async () => proxied(data));
  }

  describe("postSerpTasks", () => {
    it("queues every keyword in one request and returns the task ids", async () => {
      mockDataForSeo(created(2));
      const ids = await postSerpTasks({
        ...query,
        keywords: ["running shoes", "c++ 50%"],
      });
      expect(ids).toEqual(["t1", "t2"]);
      expect(m.composioFetch).toHaveBeenCalledTimes(1);
      expect(requests()[0]).toEqual({
        endpoint: `${API}/serp/google/organic/task_post`,
        method: "POST",
        connected_account_id: "ca_seo",
        body: [
          {
            keyword: "running shoes",
            location_code: 2840,
            language_code: "en",
            depth: 10,
          },
          {
            keyword: "c%2B%2B 50%25",
            location_code: 2840,
            language_code: "en",
            depth: 10,
          },
        ],
      });
    });

    it("keeps the tasks DataForSEO accepted when one is refused", async () => {
      mockDataForSeo({
        tasks: [
          { id: "t1", status_code: 20100 },
          { id: "t2", status_code: 40501, status_message: "Invalid Field." },
        ],
      });
      expect(await postSerpTasks(query)).toEqual(["t1"]);
    });

    it("returns no ids, not an error, when every task is refused", async () => {
      mockDataForSeo({
        tasks: [{ id: "t1", status_code: 40501, status_message: "Invalid." }],
      });
      expect(await postSerpTasks(query)).toEqual([]);
    });

    it("raises a tool error for a failed envelope", async () => {
      mockDataForSeo({
        status_code: 40101,
        status_message: "Authentication failed.",
        tasks: [],
      });
      await expect(postSerpTasks(query)).rejects.toMatchObject({
        providerStatus: 40101,
      });
    });

    it("raises a configuration error without the platform connection, before any call", async () => {
      m.getEnv.mockReturnValue({});
      await expect(postSerpTasks(query)).rejects.toBeInstanceOf(
        ComposioConfigError,
      );
      expect(m.composioFetch).not.toHaveBeenCalled();
    });
  });

  describe("postAdsSearchTasks", () => {
    it("queues one task per domain, for the last 30 days, in one request", async () => {
      mockDataForSeo(created(2));
      expect(
        await postAdsSearchTasks(["acme.com", "trail.co"], 2840, NOW),
      ).toEqual(["t1", "t2"]);
      expect(m.composioFetch).toHaveBeenCalledTimes(1);
      expect(requests()[0]).toMatchObject({
        endpoint: `${API}/serp/google/ads_search/task_post`,
        method: "POST",
        body: [
          {
            target: "acme.com",
            location_code: 2840,
            date_from: "2026-09-01",
            date_to: "2026-10-01",
            depth: 40,
          },
          { target: "trail.co" },
        ],
      });
    });
  });

  describe("postAdsSearchTasks refusals", () => {
    it("returns no ids when every task is refused, and raises on a failed envelope", async () => {
      mockDataForSeo({
        tasks: [{ status_code: 40501, status_message: "Invalid." }],
      });
      expect(await postAdsSearchTasks(["acme.com"], 2840, NOW)).toEqual([]);
      mockDataForSeo({ status_code: 40101, tasks: [] });
      await expect(
        postAdsSearchTasks(["acme.com"], 2840, NOW),
      ).rejects.toMatchObject({ providerStatus: 40101 });
    });
  });

  describe("getTaskResult", () => {
    it("reads the task through the proxy with a GET and no body", async () => {
      mockDataForSeo(task([]));
      await getTaskResult("organic", "t1");
      expect(requests()[0]).toEqual({
        endpoint: `${API}/serp/google/organic/task_get/advanced/t1`,
        method: "GET",
        connected_account_id: "ca_seo",
      });
      await getTaskResult("ads_search", "t2");
      expect(requests()[1]?.endpoint).toBe(
        `${API}/serp/google/ads_search/task_get/advanced/t2`,
      );
    });

    it.each([
      [40601, "handed to a worker"],
      [40602, "in the queue"],
    ])("is pending while the task is %s (%s)", async (code) => {
      mockDataForSeo(task(null, code, "Task In Queue."));
      expect(await getTaskResult("organic", "t1")).toEqual({
        state: "pending",
      });
    });

    it("is done with the items of every result", async () => {
      mockDataForSeo(
        task([{ items: [{ type: "organic" }] }, { items: [{ type: "ads" }] }]),
      );
      expect(await getTaskResult("organic", "t1")).toEqual({
        state: "done",
        items: [{ type: "organic" }, { type: "ads" }],
      });
    });

    it("is done without items for a task without results (40102)", async () => {
      mockDataForSeo(task(null, 40102, "No Search Results."));
      expect(await getTaskResult("ads_search", "t1")).toEqual({
        state: "done",
        items: [],
      });
    });

    it.each([40401, 40501, 50000])(
      "is failed, not an error, for task status %s",
      async (code) => {
        mockDataForSeo(task(null, code, "Nope."));
        expect(await getTaskResult("organic", "t1")).toEqual({
          state: "failed",
        });
      },
    );

    it("raises for a failed envelope or a malformed response", async () => {
      mockDataForSeo({ status_code: 40101, tasks: [] });
      await expect(getTaskResult("organic", "t1")).rejects.toMatchObject({
        providerStatus: 40101,
      });
      mockDataForSeo({ tasks: [] });
      await expect(getTaskResult("organic", "t1")).rejects.toThrow(
        "invalid response",
      );
    });
  });
});

describe("organicRanks", () => {
  const organic = (domain: string, rank: number) => ({
    type: "organic",
    rank_group: rank,
    domain,
  });

  it("keeps organic results only, each domain once at its best position, without www", () => {
    expect(
      organicRanks([
        { type: "local_pack", rank_group: 1, title: "Shop" },
        { type: "ai_overview" },
        organic("www.Acme.com", 4),
        organic("acme.com", 2),
        organic("trail.co", 3),
      ]),
    ).toEqual([
      { domain: "acme.com", rank: 2 },
      { domain: "trail.co", rank: 3 },
    ]);
  });

  it("skips platforms that rank for almost any query", () => {
    expect(
      organicRanks([
        organic("www.reddit.com", 1),
        organic("en.wikipedia.org", 2),
        organic("www.amazon.co.uk", 3),
        organic("x.com", 4),
        organic("acme.com", 5),
        organic("redditshoes.com", 6),
      ]).map((r) => r.domain),
    ).toEqual(["acme.com", "redditshoes.com"]);
  });

  it("rejects a malformed organic result", () => {
    expect(() => organicRanks([{ type: "organic", rank_group: 1 }])).toThrow(
      "invalid response",
    );
  });
});

describe("rankCompetitorDomains", () => {
  it("ranks by keywords ranked for, then best position", () => {
    expect(
      rankCompetitorDomains([
        [
          { domain: "solo-top.com", rank: 1 },
          { domain: "both.com", rank: 5 },
          { domain: "both-low.com", rank: 9 },
        ],
        [
          { domain: "both.com", rank: 2 },
          { domain: "both-low.com", rank: 8 },
        ],
      ]),
    ).toEqual(["both.com", "both-low.com", "solo-top.com"]);
  });

  it("keeps the 10 strongest and returns none without results", () => {
    const ranks = Array.from({ length: 12 }, (_, i) => ({
      domain: `d${i}.com`,
      rank: i + 1,
    }));
    const domains = rankCompetitorDomains([ranks]);
    expect(domains).toHaveLength(10);
    expect(domains[0]).toBe("d0.com");
    expect(domains).not.toContain("d11.com");
    expect(rankCompetitorDomains([[], []])).toEqual([]);
  });
});

describe("competitorAds and mergeMarketAds", () => {
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

  it("keeps a competitor's 4 most recent ads", () => {
    const days = [1, 9, 3, 7, 5, 2];
    expect(
      competitorAds(
        days.map((day) =>
          ad({
            creative_id: `D${day}`,
            last_shown: `2026-09-0${day} 00:00:00 +00:00`,
          }),
        ),
      ).map((a) => a.creativeId),
    ).toEqual(["D9", "D7", "D5", "D3"]);
  });

  it("maps ads and drops non-https links", () => {
    const [full, text, video, odd] = competitorAds([
      ad(),
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
        preview_image: { url: "http://insecure.example/a.png" },
        last_shown: "2026-09-28 00:00:00 +00:00",
      }),
      ad({
        creative_id: "ODD",
        format: "carousel",
        preview_image: undefined,
        last_shown: "2026-09-27 00:00:00 +00:00",
      }),
    ]);
    expect(full).toEqual({
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
    expect(text).toMatchObject({
      format: "text",
      previewImage: null,
      previewUrl: null,
    });
    expect(video).toMatchObject({ format: "video", previewImage: null });
    expect(odd).toMatchObject({ format: "other", previewImage: null });
  });

  it("rejects a malformed ad", () => {
    expect(() => competitorAds([{ title: "no ids" }])).toThrow(
      "invalid response",
    );
  });

  it("merges competitors: a creative once, at its latest sighting, last shown first", () => {
    const [cr1, old] = competitorAds([
      ad(),
      ad({ creative_id: "OLD", last_shown: "2026-09-10 00:00:00 +00:00" }),
    ]);
    const [seenEarlier] = competitorAds([
      ad({ last_shown: "2026-01-01 00:00:00 +00:00" }),
    ]);
    expect(mergeMarketAds([[old, cr1], [seenEarlier]])).toEqual([cr1, old]);
    expect(mergeMarketAds([])).toEqual([]);
  });
});
