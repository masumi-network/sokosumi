import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { seoSerpMarkers } from "./seo-serp-features-model";
import { seoTestKeyword } from "./seo-test-fixture";

type Series = NonNullable<ProjectSeoWorkspace["serpHistory"]>[number];
type Point = Series["points"][number];

const point = (day: string, patch: Partial<Point> = {}): Point => ({
  observedAt: new Date(`2026-10-${day}T08:00:00Z`),
  observationId: "observation",
  pages: [0],
  itemTypes: ["organic"],
  aiOverview: null,
  featured: null,
  paaOwned: false,
  suspect: false,
  ...patch,
});
const series = (patch: Partial<Series>, points: Point[]): Series => ({
  keyword: "battery app",
  device: "desktop",
  countryCode: "US",
  languageCode: "en",
  pageUrls: ["https://example.com/"],
  points,
  ...patch,
});
const ai = (shown: boolean, pageCited: boolean | null = false) => ({
  shown,
  asyncLoaded: true,
  citedDomains: [],
  pageCited,
});

describe("seoSerpMarkers", () => {
  it("tells a not-checked AI Overview from an absent one, and a cited page from a shown overview", () => {
    const marks = seoSerpMarkers(
      [
        series({}, [
          point("01"),
          point("02", { aiOverview: ai(false) }),
          point("03", { aiOverview: ai(true) }),
          point("04", { aiOverview: ai(true, true) }),
          point("05", { aiOverview: ai(true, null) }),
        ]),
      ],
      [seoTestKeyword()],
    );
    expect(
      marks.map((mark) => (mark.suspect ? "suspect" : mark.aiOverview)),
    ).toEqual(["undetermined", "cited", "shown", "absent", "not_checked"]);
  });

  it("reads a citation for the row's page only from a check that read it", () => {
    const pageUrls = ["https://example.com/", "https://example.com/pricing"];
    const home = "https://example.com/#top";
    const mark = (
      pages: number[],
      pageCited: boolean | null,
      pageUrl: string | null,
    ) =>
      seoSerpMarkers(
        [
          series({ pageUrls }, [
            point("01", { pages, aiOverview: ai(true, pageCited) }),
          ]),
        ],
        [seoTestKeyword({ pageUrl })],
      ).map((item) => (item.suspect ? "suspect" : item.aiOverview));
    expect(mark([0], true, home)).toEqual(["cited"]);
    // The check read the row's page with another: a citation names neither.
    expect(mark([0, 1], true, home)).toEqual(["cited_checked"]);
    expect(mark([0, 1], false, home)).toEqual(["shown"]);
    expect(mark([0, 1], null, home)).toEqual(["undetermined"]);
    // A check of another page says nothing about the row's page.
    expect(mark([1], false, home)).toEqual(["other_page"]);
    expect(mark([1], true, home)).toEqual(["other_page"]);
    expect(mark([1], null, home)).toEqual(["other_page"]);
    // A row without a page reads the check's pages together.
    expect(mark([0], true, null)).toEqual(["cited_checked"]);
  });

  it("reads the featured snippet, People also ask and other features of a check", () => {
    const [mark] = seoSerpMarkers(
      [
        series({}, [
          point("01", {
            itemTypes: [
              "organic",
              "featured_snippet",
              "people_also_ask",
              "video",
              "discussions_and_forums",
              "related_searches",
              "unknown_new_type",
            ],
            featured: { domain: "rival.test", pageOwned: false },
          }),
        ]),
      ],
      [seoTestKeyword()],
    );
    expect(mark).toMatchObject({
      featured: "other",
      peopleAlsoAsk: "shown",
      features: ["video", "discussions_and_forums"],
      otherFeatures: 2,
    });
  });

  it("names a suspect read without its data", () => {
    const [mark] = seoSerpMarkers(
      [series({}, [point("01", { suspect: true, paaOwned: true })])],
      [seoTestKeyword()],
    );
    expect(mark).toEqual({
      date: new Date("2026-10-01T08:00:00Z"),
      device: "desktop",
      observationId: "observation",
      suspect: true,
    });
  });

  it("keeps only the reads of the row's keyword, Market and devices, newest first", () => {
    const marks = seoSerpMarkers(
      [
        series({ keyword: "Battery  App" }, [
          point("01", { paaOwned: true }),
          point("03"),
        ]),
        series({ device: "mobile" }, [point("02")]),
        series({ countryCode: "DE" }, [point("04")]),
        series({ keyword: "other" }, [point("05")]),
      ],
      [seoTestKeyword()],
    );
    expect(marks.map((mark) => [mark.date.getUTCDate(), mark.device])).toEqual([
      [3, "desktop"],
      [1, "desktop"],
    ]);
    expect(marks[1]).toMatchObject({ peopleAlsoAsk: "owned" });
    // A row without a device stands for every device.
    expect(
      seoSerpMarkers(
        [series({ device: "mobile" }, [point("02")])],
        [seoTestKeyword({ device: null })],
      ),
    ).toHaveLength(1);
  });

  it("has no markers for a workspace from before SERP reads", () => {
    expect(seoSerpMarkers(undefined, [seoTestKeyword()])).toEqual([]);
  });
});
