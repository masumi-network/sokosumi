import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { fetchMarketKeywords } from "./dataforseo";

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
