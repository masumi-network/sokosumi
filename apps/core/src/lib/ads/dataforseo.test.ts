import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { fetchMarketAds, fetchMarketKeywords } from "./dataforseo";

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
  body: Record<string, unknown>[];
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

describe("fetchMarketAds", () => {
  const adsQuery = { ...query, keywords: ["running shoes", "trail"] };
  const NOW = new Date("2026-10-01T12:00:00.000Z");
  const ORGANIC = `${API}/serp/google/organic/live/advanced`;
  const ADS_SEARCH = `${API}/serp/google/ads_search/live/advanced`;

  const organic = (domain: string, rank: number) => ({
    type: "organic",
    rank_group: rank,
    domain,
  });
  /** A SERP task with the given organic results, plus a non-organic item. */
  const serp = (...items: unknown[]) =>
    task([
      {
        type: "organic",
        items: [{ type: "local_pack", rank_group: 1, title: "Shop" }, ...items],
      },
    ]);
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
  const adsTask = (...items: unknown[]) =>
    task([{ type: "ads_search", items }]);
  const NO_RESULTS = task(null, 40102, "No Search Results.");

  /**
   * Answers SERP calls by keyword and ads searches by target domain; anything
   * not listed has no results.
   */
  function mockDataForSeo(
    serps: Record<string, unknown>,
    adsByDomain: Record<string, unknown> = {},
  ) {
    m.composioFetch.mockImplementation(
      async (_path: string, { jsonBody }: { jsonBody: ProxyRequest }) => {
        const [body] = jsonBody.body;
        const data =
          jsonBody.endpoint === ORGANIC
            ? serps[String(body?.keyword)]
            : adsByDomain[String(body?.target)];
        return proxied(data ?? NO_RESULTS);
      },
    );
  }
  const bodiesOf = (endpoint: string) =>
    requests()
      .filter((request) => request.endpoint === endpoint)
      .map((request) => request.body);

  beforeEach(() => {
    vi.resetAllMocks();
    m.getEnv.mockReturnValue({
      COMPOSIO_DATAFORSEO_CONNECTED_ACCOUNT_ID: "ca_seo",
    });
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("reads the organic results per keyword, then each competitor's ads in the market", async () => {
    mockDataForSeo({
      "running shoes": serp(organic("acme.com", 1)),
      trail: serp(organic("trail.co", 2)),
    });
    await fetchMarketAds(adsQuery);
    // DataForSEO live endpoints take one task per request.
    expect(bodiesOf(ORGANIC)).toEqual([
      [
        {
          keyword: "running shoes",
          location_code: 2840,
          language_code: "en",
          depth: 10,
        },
      ],
      [
        {
          keyword: "trail",
          location_code: 2840,
          language_code: "en",
          depth: 10,
        },
      ],
    ]);
    expect(bodiesOf(ADS_SEARCH)).toEqual([
      [
        {
          target: "acme.com",
          location_code: 2840,
          date_from: "2026-09-01",
          date_to: "2026-10-01",
          depth: 40,
        },
      ],
      [expect.objectContaining({ target: "trail.co" })],
    ]);
    for (const request of requests()) {
      expect(request).toMatchObject({
        method: "POST",
        connected_account_id: "ca_seo",
      });
    }
  });

  it("encodes % and + in keywords, and nothing else", async () => {
    mockDataForSeo({});
    await fetchMarketAds({ ...query, keywords: ["c++", "50% off", "a&b é"] });
    expect(bodiesOf(ORGANIC).map(([body]) => body?.keyword)).toEqual([
      "c%2B%2B",
      "50%25 off",
      "a&b é",
    ]);
  });

  it("ranks competitors by keywords ranked for, then best position, without www", async () => {
    mockDataForSeo({
      "running shoes": serp(
        organic("www.solo-top.com", 1),
        organic("Both.com", 5),
        organic("both-low.com", 9),
      ),
      trail: serp(organic("both.com", 2), organic("both-low.com", 8)),
    });
    await fetchMarketAds(adsQuery);
    expect(bodiesOf(ADS_SEARCH).map(([body]) => body?.target)).toEqual([
      "both.com", // two keywords, best rank 2
      "both-low.com", // two keywords, best rank 8
      "solo-top.com",
    ]);
  });

  it("skips platforms that rank for almost any query", async () => {
    mockDataForSeo({
      "running shoes": serp(
        organic("www.reddit.com", 1),
        organic("en.wikipedia.org", 2),
        organic("www.amazon.co.uk", 3),
        organic("x.com", 4),
        organic("acme.com", 5),
        organic("redditshoes.com", 6),
      ),
    });
    await fetchMarketAds(adsQuery);
    expect(bodiesOf(ADS_SEARCH).map(([body]) => body?.target)).toEqual([
      "acme.com",
      "redditshoes.com",
    ]);
  });

  it("asks for the ads of the 10 strongest competitors only", async () => {
    mockDataForSeo({
      "running shoes": serp(
        ...Array.from({ length: 12 }, (_, i) => organic(`d${i}.com`, i + 1)),
      ),
    });
    await fetchMarketAds(adsQuery);
    const targets = bodiesOf(ADS_SEARCH).map(([body]) => body?.target);
    expect(targets).toHaveLength(10);
    expect(targets[0]).toBe("d0.com");
    expect(targets).not.toContain("d11.com");
  });

  it("returns no ads, without searching ads, when no keyword has organic results", async () => {
    mockDataForSeo({ trail: serp() });
    expect(await fetchMarketAds(adsQuery)).toEqual([]);
    expect(bodiesOf(ADS_SEARCH)).toHaveLength(0);
  });

  it("skips competitors without ads (40102)", async () => {
    mockDataForSeo(
      {
        "running shoes": serp(organic("quiet.com", 1), organic("acme.com", 2)),
      },
      { "acme.com": adsTask(ad()) },
    );
    expect((await fetchMarketAds(adsQuery)).map((a) => a.creativeId)).toEqual([
      "CR1",
    ]);
  });

  it("keeps each competitor's 4 most recent ads", async () => {
    const days = [1, 9, 3, 7, 5, 2];
    mockDataForSeo(
      { "running shoes": serp(organic("acme.com", 1)) },
      {
        "acme.com": adsTask(
          ...days.map((day) =>
            ad({
              creative_id: `D${day}`,
              last_shown: `2026-09-0${day} 00:00:00 +00:00`,
            }),
          ),
        ),
      },
    );
    expect((await fetchMarketAds(adsQuery)).map((a) => a.creativeId)).toEqual([
      "D9",
      "D7",
      "D5",
      "D3",
    ]);
  });

  it("maps ads, dedupes by creative, sorts by last shown and drops non-https links", async () => {
    mockDataForSeo(
      {
        "running shoes": serp(organic("acme.com", 1), organic("other.com", 2)),
      },
      {
        "acme.com": adsTask(
          ad({ creative_id: "OLD", last_shown: "2026-09-10 00:00:00 +00:00" }),
          ad({ creative_id: "CR1" }),
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
        ),
        "other.com": adsTask(
          // The same creative under a second domain, seen earlier.
          ad({ creative_id: "CR1", last_shown: "2026-01-01 00:00:00 +00:00" }),
          ad({
            creative_id: "ODD",
            format: "carousel",
            preview_image: undefined,
            last_shown: "2026-09-27 00:00:00 +00:00",
          }),
        ),
      },
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

  it("treats an ads search without results as no ads", async () => {
    mockDataForSeo(
      { "running shoes": serp(organic("acme.com", 1)) },
      { "acme.com": task(null) },
    );
    expect(await fetchMarketAds(adsQuery)).toEqual([]);
  });

  it("skips a keyword whose SERP fails, keeping the others", async () => {
    mockDataForSeo({
      "running shoes": serp(organic("acme.com", 1)),
      trail: task(null, 40501, "Invalid Field."),
    });
    await fetchMarketAds(adsQuery);
    expect(bodiesOf(ADS_SEARCH).map(([body]) => body?.target)).toEqual([
      "acme.com",
    ]);
  });

  it("raises when every keyword's SERP fails, and never searches ads", async () => {
    mockDataForSeo({
      "running shoes": task(null, 40501, "Invalid Field."),
      trail: task(null, 50000, "Internal Error."),
    });
    await expect(fetchMarketAds(adsQuery)).rejects.toMatchObject({
      name: "ComposioToolError",
      providerStatus: 40501,
    });
    expect(bodiesOf(ADS_SEARCH)).toHaveLength(0);
  });

  it("skips a competitor whose ads search fails, keeping the others", async () => {
    mockDataForSeo(
      { "running shoes": serp(organic("slow.com", 1), organic("acme.com", 2)) },
      {
        "slow.com": task(null, 50000, "Internal Error."),
        "acme.com": adsTask(ad()),
      },
    );
    expect((await fetchMarketAds(adsQuery)).map((a) => a.creativeId)).toEqual([
      "CR1",
    ]);
  });

  it("raises when every competitor's ads search fails", async () => {
    const serps = {
      "running shoes": serp(organic("acme.com", 1), organic("other.com", 2)),
    };
    mockDataForSeo(serps, {
      "acme.com": task(null, 50000, "Internal Error."),
      "other.com": task(null, 50000, "Internal Error."),
    });
    await expect(fetchMarketAds(adsQuery)).rejects.toBeInstanceOf(
      ComposioToolError,
    );
    mockDataForSeo(serps, {
      "acme.com": {
        status_code: 40101,
        status_message: "Authentication failed.",
        tasks: [],
      },
      "other.com": task(null, 50000, "Internal Error."),
    });
    await expect(fetchMarketAds(adsQuery)).rejects.toMatchObject({
      providerStatus: 40101,
    });
  });

  it("rejects a malformed organic result or ad", async () => {
    mockDataForSeo({
      "running shoes": serp({ type: "organic", rank_group: 1 }),
    });
    await expect(fetchMarketAds(adsQuery)).rejects.toThrow("invalid response");
    mockDataForSeo(
      { "running shoes": serp(organic("acme.com", 1)) },
      { "acme.com": adsTask({ type: "ads_search", title: "no ids" }) },
    );
    await expect(fetchMarketAds(adsQuery)).rejects.toThrow("invalid response");
  });

  it("raises a configuration error without the platform connection, before any call", async () => {
    m.getEnv.mockReturnValue({});
    await expect(fetchMarketAds(adsQuery)).rejects.toBeInstanceOf(
      ComposioConfigError,
    );
    expect(m.composioFetch).not.toHaveBeenCalled();
  });
});
