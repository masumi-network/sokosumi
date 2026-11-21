import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { seoTaskSearchConsoleReadSchema } from "@/schemas/seo-task-search-console.schema";
import {
  gscTaskReadRecord,
  gscTaskReplyBody,
  gscTaskToolArguments,
  holdsCredentialField,
  isAuditPageUrl,
} from "./search-console-task-read";

const PROPERTY = "sc-domain:example.test";
const expected = { expectedOwnerId: "owner", expectedOrganizationId: null };
const sitesList = seoTaskSearchConsoleReadSchema.parse({
  operation: "sites.list",
  ...expected,
});
const analytics = (query: Record<string, unknown> = {}) =>
  seoTaskSearchConsoleReadSchema.parse({
    operation: "searchAnalytics.query",
    siteUrl: PROPERTY,
    query: {
      startDate: "2025-07-21",
      endDate: "2026-11-20",
      rowLimit: 100,
      startRow: 0,
      ...query,
    },
    ...expected,
  });
const inspect = seoTaskSearchConsoleReadSchema.parse({
  operation: "urlInspection.inspect",
  siteUrl: PROPERTY,
  inspectionUrl: "https://example.test/a",
  ...expected,
});
const ROW = { keys: ["widget"], clicks: 3, impressions: 40, ctr: 0.075 };
// Every documented key of Google's UrlInspectionResult.
const INSPECTION = {
  inspectionResultLink: "https://search.google.com/search-console/inspect",
  indexStatusResult: {
    sitemap: ["https://example.test/sitemap.xml"],
    referringUrls: ["https://example.test/"],
    verdict: "PASS",
    coverageState: "Submitted and indexed",
    robotsTxtState: "ALLOWED",
    indexingState: "INDEXING_ALLOWED",
    lastCrawlTime: "2026-11-01T00:00:00Z",
    pageFetchState: "SUCCESSFUL",
    googleCanonical: "https://example.test/a",
    userCanonical: "https://example.test/a",
    crawledAs: "MOBILE",
  },
  ampResult: {
    issues: [{ issueMessage: "x", severity: "WARNING" }],
    verdict: "PASS",
    ampUrl: "https://example.test/a/amp",
    robotsTxtState: "ALLOWED",
    indexingState: "AMP_INDEXING_ALLOWED",
    ampIndexStatusVerdict: "PASS",
    lastCrawlTime: "2026-11-01T00:00:00Z",
    pageFetchState: "SUCCESSFUL",
  },
  mobileUsabilityResult: {
    verdict: "PASS",
    issues: [{ issueType: "x", severity: "WARNING", message: "x" }],
  },
  richResultsResult: {
    verdict: "PASS",
    detectedItems: [
      {
        richResultType: "Product snippets",
        items: [{ name: "x", issues: [{ issueMessage: "x", severity: "x" }] }],
      },
    ],
  },
};

function replyStatus(run: () => unknown) {
  try {
    run();
    return 200;
  } catch (error) {
    if (error instanceof HTTPException) return error.status;
    throw error;
  }
}

describe("gscTaskToolArguments", () => {
  it("sends Core's property and the proven defaults for an omitted analytics field", () => {
    expect(gscTaskToolArguments(sitesList, PROPERTY)).toEqual({});
    expect(gscTaskToolArguments(inspect, PROPERTY)).toEqual({
      site_url: PROPERTY,
      inspection_url: "https://example.test/a",
    });
    expect(gscTaskToolArguments(analytics(), PROPERTY)).toEqual({
      site_url: PROPERTY,
      start_date: "2025-07-21",
      end_date: "2026-11-20",
      row_limit: 100,
      start_row: 0,
      dimensions: [],
      search_type: "web",
      data_state: "final",
    });
  });

  it("maps every analytics field to the tool's argument name", () => {
    const filters = [
      {
        groupType: "and",
        filters: [{ dimension: "page", operator: "equals", expression: "x" }],
      },
    ];
    expect(
      gscTaskToolArguments(
        analytics({
          dimensions: ["page", "date"],
          type: "discover",
          dataState: "all",
          aggregationType: "byPage",
          dimensionFilterGroups: filters,
        }),
        PROPERTY,
      ),
    ).toMatchObject({
      dimensions: ["page", "date"],
      search_type: "discover",
      data_state: "all",
      aggregation_type: "byPage",
      dimension_filter_groups: filters,
    });
  });
});

describe("isAuditPageUrl", () => {
  const pages = ["https://example.test/a", "http://www.shop.test/b/?x=1"];
  it.each([
    ["https://example.test/a", true],
    ["http://example.test/a", true],
    ["https://www.example.test/a", true],
    ["https://shop.test/b?x=1", true],
    ["https://example.test/a/", true],
    ["https://example.test/c", false],
    ["https://other.test/a", false],
    ["https://example.test/a?x=1", false],
    ["https://example.test:8443/a", false],
    ["not a url", false],
    ["ftp://example.test/a", false],
    ["https://example.test/a#!/private", false],
    ["https://example.test/a#top", false],
  ])("%s is an audit page: %s", (url, same) => {
    expect(isAuditPageUrl(url, pages)).toBe(same);
  });

  it("keeps a `www` label that is the whole name before the top-level domain", () => {
    expect(isAuditPageUrl("https://com/a", ["https://www.com/a"])).toBe(false);
    expect(isAuditPageUrl("https://www.com/a", ["https://www.com/a"])).toBe(
      true,
    );
  });
});

describe("holdsCredentialField", () => {
  it("reads a 200,000-element array without a stack overflow", () => {
    const long = Array.from({ length: 200_000 }, (_, index) => index);
    expect(holdsCredentialField(long)).toBe(false);
  });

  it("allows the pagination key nextPageToken and no other token key", () => {
    expect(holdsCredentialField({ rows: [], nextPageToken: "x" })).toBe(false);
    expect(holdsCredentialField({ rows: [], next_page_token: "x" })).toBe(
      false,
    );
    expect(holdsCredentialField({ rows: [], accessToken: "x" })).toBe(true);
    expect(holdsCredentialField({ rows: [], pageToken: "x" })).toBe(true);
  });
});

describe("gscTaskReplyBody", () => {
  it("keeps only the approved property in the site list, with a null permission level", () => {
    const data = {
      successful: true,
      data: {
        siteEntry: [
          { siteUrl: "https://other.test/", permissionLevel: "siteOwner" },
          { siteUrl: PROPERTY, permissionLevel: null },
        ],
      },
    };
    expect(gscTaskReplyBody(sitesList, PROPERTY, data)).toEqual({
      status: 200,
      body: { siteEntry: [{ siteUrl: PROPERTY, permissionLevel: null }] },
    });
  });

  it("returns Google's analytics body with its metadata for dataState all", () => {
    const body = {
      rows: [{ ...ROW, position: 4.2 }, ROW],
      responseAggregationType: "byPage",
      metadata: {
        firstIncompleteDate: "2026-11-19",
        firstIncompleteHour: "2026-11-19T10:00:00-08:00",
      },
    };
    expect(
      gscTaskReplyBody(analytics({ dataState: "all" }), PROPERTY, {
        successful: true,
        data: JSON.stringify(body),
      }),
    ).toEqual({ status: 200, body });
  });

  it("accepts an analytics reply with only metadata, and refuses a metadata value that is no object", () => {
    const metadata = { firstIncompleteDate: "2026-11-19" };
    expect(
      gscTaskReplyBody(analytics({ dataState: "all" }), PROPERTY, {
        successful: true,
        data: { metadata },
      }),
    ).toEqual({ status: 200, body: { metadata } });
    // Rows under an unknown name must not read as "no rows".
    for (const data of [
      { metadata: 1 },
      { metadata: [metadata] },
      { metadata, results: [{ keys: ["q"], clicks: 1 }] },
      { successful: true, data: { metadata: { total: 1 }, items: [1] } },
    ])
      expect(
        replyStatus(() => gscTaskReplyBody(analytics(), PROPERTY, data)),
        JSON.stringify(data),
      ).toBe(502);
    expect(
      replyStatus(() => gscTaskReplyBody(inspect, PROPERTY, { metadata })),
    ).toBe(502);
  });

  it("returns the whole inspection result", () => {
    expect(
      gscTaskReplyBody(inspect, PROPERTY, { inspectionResult: INSPECTION }),
    ).toEqual({ status: 200, body: { inspectionResult: INSPECTION } });
  });

  it("refuses a reply with none of the operation's keys, but reads an empty one as no rows", () => {
    expect(replyStatus(() => gscTaskReplyBody(analytics(), PROPERTY, {}))).toBe(
      200,
    );
    expect(gscTaskReplyBody(sitesList, PROPERTY, { kind: "x" })).toEqual({
      status: 200,
      body: { siteEntry: [] },
    });
    for (const read of [analytics(), sitesList, inspect])
      for (const data of [{ foo: 1 }, { kind: "x", result: [ROW] }])
        expect(
          replyStatus(() => gscTaskReplyBody(read, PROPERTY, data)),
          `${read.operation} ${JSON.stringify(data)}`,
        ).toBe(502);
  });

  it("refuses a reply with a credential key at any depth", () => {
    for (const key of [
      "token",
      "oauth_token",
      "access_token",
      "clientSecret",
      "secret",
      "Bearer",
      "x-api-key",
      "API_KEY",
      "Cookie",
      "set-cookie",
      "password",
      "Authorization",
      "connected_account_id",
    ]) {
      const data = {
        inspectionResult: {
          ...INSPECTION,
          richResultsResult: { detectedItems: [{ items: [{ [key]: "x" }] }] },
        },
      };
      expect(holdsCredentialField(data), key).toBe(true);
      expect(replyStatus(() => gscTaskReplyBody(inspect, PROPERTY, data))).toBe(
        502,
      );
    }
    expect(holdsCredentialField({ inspectionResult: INSPECTION })).toBe(false);
  });
});

describe("gscTaskReadRecord", () => {
  const PAGE = "https://example.test/pricing";
  const sha256 = expect.stringMatching(/^[0-9a-f]{64}$/);

  it("keeps the shape of a query and no filter text", () => {
    const record = gscTaskReadRecord(
      analytics({
        dimensions: ["query"],
        dimensionFilterGroups: [
          {
            filters: [
              { dimension: "page", operator: "equals", expression: PAGE },
              { dimension: "query", expression: "private term" },
            ],
          },
        ],
      }),
    );
    expect(record).toEqual({
      operation: "searchAnalytics.query",
      query: {
        startDate: "2025-07-21",
        endDate: "2026-11-20",
        rowLimit: 100,
        startRow: 0,
        dimensions: ["query"],
        filters: [
          { dimension: "page", operator: "equals", expressionSha256: sha256 },
          { dimension: "query", expressionSha256: sha256 },
        ],
      },
    });
    const text = JSON.stringify(record);
    expect(text).not.toContain("example.test");
    expect(text).not.toContain("private term");
  });

  it("gives the same hash for the same text, and no inspected URL", () => {
    const inspect = (inspectionUrl: string) =>
      gscTaskReadRecord(
        seoTaskSearchConsoleReadSchema.parse({
          operation: "urlInspection.inspect",
          siteUrl: PROPERTY,
          inspectionUrl,
          ...expected,
        }),
      );
    expect(inspect(PAGE)).toEqual({
      operation: "urlInspection.inspect",
      inspectionUrlSha256: sha256,
    });
    expect(inspect(PAGE)).toEqual(inspect(PAGE));
    expect(inspect(PAGE)).not.toEqual(inspect(`${PAGE}/other`));
    expect(gscTaskReadRecord(sitesList)).toEqual({ operation: "sites.list" });
  });
});
