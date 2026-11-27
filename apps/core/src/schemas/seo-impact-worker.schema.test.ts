import { describe, expect, it } from "vitest";

import fixture from "@/test-fixtures/seo-impact-verdict.json";

import {
  SEO_IMPACT_INPUT_MAX_BYTES,
  SEO_IMPACT_MAX_CANDIDATES,
  SEO_IMPACT_MAX_PROPERTY_CHARS,
  SEO_IMPACT_MAX_SERIES_DAYS,
  SEO_IMPACT_MAX_URL_CHARS,
  seoImpactInputSchema,
  seoImpactResultSchema,
} from "./seo-impact-worker.schema";

// A copy of seo-bot test/fixtures/impact-verdict.json: the worker's own input
// and the result it computes from it.
const input = () => structuredClone(fixture.input);

describe("seo-bot impact contract", () => {
  it("accepts the worker's own input and result", () => {
    expect(seoImpactInputSchema.safeParse(fixture.input).success).toBe(true);
    expect(seoImpactResultSchema.parse(fixture.result)).toEqual(fixture.result);
  });

  it.each([
    [
      "a row after the Pacific day of readAt",
      (value: ReturnType<typeof input>) => {
        value.readAt = "2026-05-31T06:00:00Z";
      },
      "A daily row is dated after the Pacific day of readAt",
    ],
    [
      "a day the calendar does not have",
      (value: ReturnType<typeof input>) => {
        value.pageByDate[0]!.date = "2026-02-30";
      },
      "No such day",
    ],
    [
      "a page URL with a fragment",
      (value: ReturnType<typeof input>) => {
        value.pageUrl = `${value.pageUrl}#price`;
      },
      "A page URL in the worker's form: no credentials, no fragment",
    ],
    [
      "a page URL the worker would rewrite",
      (value: ReturnType<typeof input>) => {
        value.pageUrl = value.pageUrl.replace("shop.example", "SHOP.example");
      },
      "A page URL in the worker's form: no credentials, no fragment",
    ],
    [
      "a page URL with credentials",
      (value: ReturnType<typeof input>) => {
        value.pageUrl = value.pageUrl.replace("https://", "https://ada@");
      },
      "A page URL in the worker's form: no credentials, no fragment",
    ],
    [
      "a CTR rounded for display",
      (value: ReturnType<typeof input>) => {
        value.pageByDate[0]!.ctr = 0.0986;
      },
      "CTR does not match clicks and impressions",
    ],
    [
      "a candidate on another origin",
      (value: ReturnType<typeof input>) => {
        value.candidates[0]!.pageUrl = "https://other.example/products/teapot";
      },
      "A candidate is on another origin than the page",
    ],
    [
      "the changed page as a candidate",
      (value: ReturnType<typeof input>) => {
        value.candidates[0]!.pageUrl = value.pageUrl;
      },
      "A candidate is the changed page",
    ],
    [
      "the changed page as a candidate, with an escaped unreserved character",
      (value: ReturnType<typeof input>) => {
        const page = new URL(value.pageUrl);
        value.pageUrl = `${page.origin}${page.pathname.replace(/^\//, "/%7E")}`;
        value.candidates[0]!.pageUrl =
          `${page.origin}${page.pathname.replace(/^\//, "/~")}`;
      },
      "A candidate is the changed page",
    ],
    [
      "a pin that is no candidate",
      (value: ReturnType<typeof input>) => {
        value.pin = {
          comparisonPage: "https://shop.example/products/c-mug",
        } as never;
      },
      "The pinned comparison page is not a candidate",
    ],
    [
      "change bounds on a done change",
      (value: ReturnType<typeof input>) => {
        value.changeBounds = {
          earliest: value.changedAt,
          latest: value.changedAt,
        } as never;
      },
      "Only an audit recheck has change bounds",
    ],
    [
      "a page that is no URL, without throwing",
      (value: ReturnType<typeof input>) => {
        value.pageUrl = "not a url";
      },
      "Invalid URL",
    ],
    [
      "a readAt that is no time, without throwing",
      (value: ReturnType<typeof input>) => {
        value.readAt = "not a time";
      },
      "Invalid ISO datetime",
    ],
    [
      "a readAt before the year 1000, without throwing",
      (value: ReturnType<typeof input>) => {
        value.readAt = "0001-01-01T00:00:00Z";
      },
      "readAt has no Search Console day",
    ],
    [
      "audit-recheck bounds that start after changedAt",
      (value: ReturnType<typeof input>) => {
        value.changeSource = "audit_recheck" as never;
        value.changeBounds = {
          earliest: "2026-04-01T19:00:00Z",
          latest: "2026-04-02T18:00:00Z",
        } as never;
      },
      "Change bounds start at changedAt and end by readAt",
    ],
    [
      "audit-recheck bounds that end after readAt",
      (value: ReturnType<typeof input>) => {
        value.changeSource = "audit_recheck" as never;
        value.changeBounds = {
          earliest: value.changedAt,
          latest: "2026-06-03T12:00:01Z",
        } as never;
      },
      "Change bounds start at changedAt and end by readAt",
    ],
    [
      "audit-recheck bounds that end before they start",
      (value: ReturnType<typeof input>) => {
        value.changeSource = "audit_recheck" as never;
        value.changeBounds = {
          earliest: value.changedAt,
          latest: "2026-04-01T09:00:00Z",
        } as never;
      },
      "Change bounds start at changedAt and end by readAt",
    ],
  ])("refuses %s, as the worker does", (_case, change, message) => {
    const value = input();
    change(value);
    const parsed = seoImpactInputSchema.safeParse(value);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
      message,
    );
  });

  it("accepts audit-recheck bounds from changedAt to readAt", () => {
    const value = input();
    value.changeSource = "audit_recheck" as never;
    value.changeBounds = {
      earliest: value.changedAt,
      latest: value.readAt,
    } as never;
    expect(seoImpactInputSchema.safeParse(value).success).toBe(true);
  });

  it("refuses a tested result without a verdict, and a verdict on any other state", () => {
    expect(
      seoImpactResultSchema.safeParse({ ...fixture.result, verdict: null })
        .success,
    ).toBe(false);
    expect(
      seoImpactResultSchema.safeParse({
        ...fixture.result,
        state: "change not confirmed",
      }).success,
    ).toBe(false);
  });

  it("refuses a retry day the calendar does not have", () => {
    const waiting = {
      ...fixture.result,
      state: "waiting",
      verdict: null,
      retryAfter: "2026-06-10",
    };
    expect(seoImpactResultSchema.safeParse(waiting).success).toBe(true);
    expect(
      seoImpactResultSchema.safeParse({ ...waiting, retryAfter: "2026-02-30" })
        .success,
    ).toBe(false);
  });

  it("serves the largest input under the worker's byte limit", () => {
    const value = input();
    // A stored URL is its own href, which percent-encodes all but ASCII: one
    // byte of JSON for each character.
    const longUrl = (path: string) => {
      const url = `https://shop.example/${path}`;
      return url + "a".repeat(SEO_IMPACT_MAX_URL_CHARS - url.length);
    };
    // Each field at its longest JSON on its own, so the rows are an upper
    // bound, not rows the schema accepts.
    const days = Array.from(
      { length: SEO_IMPACT_MAX_SERIES_DAYS },
      (_, index) => ({
        date: new Date(Date.UTC(2025, 1, 1) + index * 86_400_000)
          .toISOString()
          .slice(0, 10),
        clicks: Number.MAX_SAFE_INTEGER,
        impressions: Number.MAX_SAFE_INTEGER,
        ctr: 1 / Number.MAX_SAFE_INTEGER,
        position: 1.234_567_890_123_456_7e300,
      }),
    );
    const candidates = Array.from(
      { length: SEO_IMPACT_MAX_CANDIDATES },
      (_, n) => ({ pageUrl: longUrl(`c${n}`), byDate: days }),
    );
    const largest = {
      claimId: value.impactId,
      claimedUntil: "2026-06-03T12:30:00.000Z",
      input: {
        ...value,
        pageUrl: longUrl("p"),
        // A control character is 6 bytes of JSON: the longest a character gets.
        property: "\u0000".repeat(SEO_IMPACT_MAX_PROPERTY_CHARS),
        pageByDate: days,
        siteByDate: days,
        candidates,
        pin: { comparisonPage: candidates[0]!.pageUrl },
      },
    };
    expect(
      Buffer.byteLength(JSON.stringify({ data: largest })),
    ).toBeLessThanOrEqual(SEO_IMPACT_INPUT_MAX_BYTES);
  });
});
