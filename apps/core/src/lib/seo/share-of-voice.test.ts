import { describe, expect, it } from "vitest";
import { seoClickRate } from "./keyword-clicks";
import {
  type SeoShareRead,
  seoBareDomain,
  seoShareOfVoice,
} from "./share-of-voice";

const read = (
  top: SeoShareRead["top"],
  patch: Partial<SeoShareRead> = {},
): SeoShareRead => ({
  keyword: "battery app",
  device: "desktop",
  countryCode: "US",
  languageCode: "en",
  // A Wednesday.
  observedAt: "2026-10-07T09:00:00.000Z",
  top,
  suspect: false,
  ...patch,
});
const ctr = seoClickRate;

describe("seoShareOfVoice", () => {
  it("splits the clicks of the read results between site, competitors, others and unattributed", () => {
    const [week] = seoShareOfVoice(
      [
        read([
          { rank: 1, domain: "rival.test" },
          { rank: 2, domain: "www.example.test" },
          { rank: 3, domain: null },
          { rank: 4, domain: "other.test" },
        ]),
      ],
      ["example.test"],
      ["www.rival.test", "quiet.test"],
    );
    const total = ctr(1) + ctr(2) + ctr(3) + ctr(4);
    expect(week.weekStart).toBe("2026-10-05");
    expect(week.reads).toBe(1);
    expect(week.site).toBeCloseTo(ctr(2) / total, 10);
    expect(week.competitors).toEqual([
      { domain: "rival.test", share: ctr(1) / total },
      // A confirmed competitor without a result still has its row.
      { domain: "quiet.test", share: 0 },
    ]);
    expect(week.unattributed).toBeCloseTo(ctr(3) / total, 10);
    expect(week.others).toBeCloseTo(ctr(4) / total, 10);
    expect(
      week.site + week.others + week.unattributed + ctr(1) / total,
    ).toBeCloseTo(1, 10);
  });

  it("gives tied ranks the same rate each, and counts a missing rank for no one", () => {
    const [week] = seoShareOfVoice(
      [
        read([
          { rank: 1, domain: "example.test" },
          { rank: 1, domain: "rival.test" },
          // Rank 2 is not in the read.
          { rank: 3, domain: "other.test" },
        ]),
      ],
      ["example.test"],
      ["rival.test"],
    );
    const total = 2 * ctr(1) + ctr(3);
    expect(week.site).toBeCloseTo(ctr(1) / total, 10);
    expect(week.competitors[0].share).toBeCloseTo(ctr(1) / total, 10);
    expect(week.others).toBeCloseTo(ctr(3) / total, 10);
  });

  it("counts the newest read of a week per keyword and device, and leaves suspect reads out", () => {
    const weeks = seoShareOfVoice(
      [
        read([{ rank: 1, domain: "rival.test" }], {
          observedAt: "2026-10-05T00:30:00.000Z",
        }),
        read([{ rank: 1, domain: "example.test" }], {
          observedAt: "2026-10-11T23:00:00.000Z",
        }),
        // A suspect read carries no results (seo-bot serpEntry); it must not replace the week's read.
        read([], { observedAt: "2026-10-11T23:30:00.000Z", suspect: true }),
        read([{ rank: 1, domain: "rival.test" }], { device: "mobile" }),
        // The Sunday before is the week before.
        read([{ rank: 1, domain: "other.test" }], {
          observedAt: "2026-10-04T23:59:00.000Z",
        }),
      ],
      ["example.test"],
      ["rival.test"],
    );
    expect(
      weeks.map((week) => [week.weekStart, week.reads, week.site, week.others]),
    ).toEqual([
      ["2026-09-28", 1, 0, 1],
      ["2026-10-05", 2, 0.5, 0],
    ]);
  });

  it("gives no week for reads without a result in the first 20 places", () => {
    expect(
      seoShareOfVoice(
        [read([]), read([{ rank: 21, domain: "x.test" }], { keyword: "b" })],
        ["example.test"],
        [],
      ),
    ).toEqual([]);
  });

  it("never lists the site as its own competitor", () => {
    const [week] = seoShareOfVoice(
      [read([{ rank: 1, domain: "example.test" }])],
      ["www.example.test"],
      ["example.test"],
    );
    expect(week.competitors).toEqual([]);
    expect(week.site).toBe(1);
  });

  it("matches an international site name in its Unicode and its ASCII form", () => {
    const [week] = seoShareOfVoice(
      [read([{ rank: 1, domain: "www.Bücher.test" }])],
      // A page URL's host: the URL parser gives the ASCII form.
      [new URL("https://bücher.test/page").hostname],
      [],
    );
    expect(week.site).toBe(1);
  });

  it("reads hosts with www. and upper case as one domain", () => {
    expect(seoBareDomain("WWW.Example.Test")).toBe("example.test");
    expect(seoBareDomain("blog.example.test")).toBe("blog.example.test");
  });
});
