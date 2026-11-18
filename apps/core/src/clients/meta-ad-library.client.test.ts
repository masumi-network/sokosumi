import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("@/config/env", () => ({
  getEnv: () => ({ META_AD_LIBRARY_ACCESS_TOKEN: env.token }),
}));

import {
  MetaAdLibraryError,
  MetaAdLibraryNotConfiguredError,
  metaAdLibraryConfigured,
  metaAdLibraryPageUrl,
  searchMetaAds,
} from "./meta-ad-library.client";

const input = {
  name: "Blue Bottle Coffee",
  facebookHandle: "bluebottlecoffee",
  since: new Date("2026-11-10T08:00:00Z"),
};

function respond(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => Response.json(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  env.token = undefined;
  vi.unstubAllGlobals();
});

describe("searchMetaAds", () => {
  it("is not configured without a token", async () => {
    expect(metaAdLibraryConfigured()).toBe(false);
    await expect(searchMetaAds(input)).rejects.toBeInstanceOf(
      MetaAdLibraryNotConfiguredError,
    );
  });

  it("asks for every ad started in the EU since the last check", async () => {
    env.token = "token-1";
    const fetchMock = respond({ data: [] });
    await searchMetaAds(input);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.origin + url.pathname).toBe(
      "https://graph.facebook.com/v27.0/ads_archive",
    );
    expect(url.searchParams.get("search_terms")).toBe("Blue Bottle Coffee");
    expect(url.searchParams.get("ad_delivery_date_min")).toBe("2026-11-10");
    expect(url.searchParams.get("ad_active_status")).toBe("ALL");
    expect(url.searchParams.get("ad_type")).toBe("ALL");
    expect(
      JSON.parse(url.searchParams.get("ad_reached_countries") ?? "[]"),
    ).toContain("DE");
    expect(url.searchParams.has("access_token")).toBe(false);
    expect(init.headers).toEqual({ authorization: "Bearer token-1" });
  });

  it("keeps only the ads of the company's own Page", async () => {
    env.token = "token-1";
    respond({
      data: [
        {
          id: "1",
          page_id: "77",
          page_name: "Blue Bottle Coffee",
          ad_delivery_start_time: "2026-11-12",
          ad_creative_bodies: ["Fresh roasts, delivered weekly."],
          ad_creative_link_titles: ["Subscribe and save"],
          publisher_platforms: ["FACEBOOK", "INSTAGRAM"],
          eu_total_reach: 4200,
        },
        {
          id: "2",
          page_id: "88",
          page_name: "Coffee Deals Daily",
          ad_creative_bodies: ["Better than Blue Bottle Coffee"],
        },
        { id: "3", page_id: "77", page_name: "bluebottlecoffee" },
        { page_id: "77", page_name: "Blue Bottle Coffee" },
      ],
    });
    expect(await searchMetaAds(input)).toEqual([
      {
        id: "1",
        pageId: "77",
        pageName: "Blue Bottle Coffee",
        startedAt: "2026-11-12",
        stoppedAt: null,
        body: "Fresh roasts, delivered weekly.",
        title: "Subscribe and save",
        platforms: ["FACEBOOK", "INSTAGRAM"],
        euReach: 4200,
      },
      {
        id: "3",
        pageId: "77",
        pageName: "bluebottlecoffee",
        startedAt: null,
        stoppedAt: null,
        body: null,
        title: null,
        platforms: [],
        euReach: null,
      },
    ]);
  });

  it("fails with Meta's status", async () => {
    env.token = "token-1";
    respond({ error: { message: "Invalid OAuth 2.0 Access Token" } }, 400);
    await expect(searchMetaAds(input)).rejects.toEqual(
      new MetaAdLibraryError(400),
    );
  });
});

describe("metaAdLibraryPageUrl", () => {
  it("links the advertiser's page in the Ad Library", () => {
    expect(metaAdLibraryPageUrl("77")).toBe(
      "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=77",
    );
  });
});
