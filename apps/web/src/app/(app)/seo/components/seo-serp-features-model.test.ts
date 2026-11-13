import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { seoSerpMarkers } from "./seo-serp-features-model";
import { seoTestKeyword } from "./seo-test-fixture";

type Series = NonNullable<ProjectSeoWorkspace["serpHistory"]>[number];
type Point = Series["points"][number];

const point = (day: string, patch: Partial<Point> = {}): Point => ({
  observedAt: new Date(`2026-10-${day}T08:00:00Z`),
  observationId: "observation",
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
