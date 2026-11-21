import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { seoTaskSearchConsoleReadSchema } from "@/schemas/seo-task-search-console.schema";
import {
  gscTaskReplyBody,
  gscTaskToolArguments,
  holdsCredentialField,
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
