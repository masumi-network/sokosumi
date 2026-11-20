import { describe, expect, it } from "vitest";
import { legacyReport, SEO_TEST_PAGE } from "@/test-fixtures/project-seo";
import {
  parsePublicSeoArtifact,
  publicSeoPayloadSchema,
} from "./project-seo-report";
import { scopedPageSpeed } from "./seo-page-speed";

const median = { lcp: 7400, fcp: 1200, cls: 0, si: 3600, tbt: 180 };
const insight = {
  id: "unused-javascript",
  title: "Reduce unused JavaScript",
  detail: "Potential savings of 108 KiB.",
  action: "Defer scripts until they are needed.",
};
const sourceRecord = "c".repeat(64);
const readings = (url: string) => ({
  mobile: {
    lab: {
      runs: 1,
      ok: 1,
      median,
      lighthouse: "13.6.0",
      sourceRefs: [
        {
          record: sourceRecord,
          port: "psi",
          request: { port: "psi", url, device: "mobile" },
          outcome: { kind: "ok", status: 200 },
        },
      ],
      pageSpeed: {
        sourceRecord,
        scores: { performance: 72 },
        insights: [
          insight,
          { ...insight, id: "foreign", detail: "contact private@example.com" },
        ],
      },
    },
    field: { none: "no CrUX data for the URL, origin: no data" },
  },
  desktop: {
    lab: { none: "Time budget expired" },
    field: {
      none: "URL: Not checked: public worker excluded CrUX",
      failed: true,
    },
  },
});

describe("imported full-audit PageSpeed evidence", () => {
  it("saves both devices for each audited page and keeps lab diagnostics separate from absent field data", () => {
    const first = legacyReport(),
      other = "https://example.test/second";
    const result = parsePublicSeoArtifact({
      kind: "site",
      rulebookVersion: "v",
      pages: [
        { ...first, speed: readings(SEO_TEST_PAGE) },
        { ...first, request: { url: other }, speed: readings(other) },
      ],
    });
    const stored = publicSeoPayloadSchema.parse(
      JSON.parse(JSON.stringify(result)),
    );
    expect(stored.pageSpeed).toHaveLength(4);
    const selected = scopedPageSpeed(stored.pageSpeed, new Set([other]));
    expect(selected).toHaveLength(2);
    expect(selected?.[0]).toMatchObject({
      pageUrl: other,
      device: "mobile",
      field: { status: "no_data" },
      lab: {
        status: "measured",
        median,
        pageSpeed: { scores: { performance: 72 }, insights: [insight] },
      },
    });
    expect(selected?.[1]).toMatchObject({
      device: "desktop",
      lab: { status: "deadline" },
      field: { status: "not_checked" },
    });
  });
  it("labels an operator budget, a Google quota and skipped field reads independently", () => {
    const raw = legacyReport();
    const field = {
      none: "Chrome UX Report field data was not collected by this public audit.",
      failed: true,
    };
    const rows = parsePublicSeoArtifact({
      ...raw,
      speed: {
        mobile: {
          field,
          lab: { none: "The audit reached its PageSpeed request budget." },
        },
        desktop: {
          field,
          lab: {
            none: "Google declined the PageSpeed request because its quota was exhausted.",
          },
        },
      },
    }).pageSpeed;
    expect(rows?.map((row) => [row.lab.status, row.field.status])).toEqual([
      ["budget", "not_checked"],
      ["quota", "not_checked"],
    ]);
  });
  it("does not assign a different page or device's lab sample to the audited page", () => {
    const raw = legacyReport();
    const speed = readings("https://other.test/");
    const result = parsePublicSeoArtifact({ ...raw, speed });
    expect(result.pageSpeed?.[0]?.lab).toEqual({ status: "unavailable" });
    expect(
      parsePublicSeoArtifact({
        ...raw,
        header: { ...raw.header, finalUrl: { mobile: "https://other.test/" } },
        speed,
      }).pageSpeed?.map((row) => row.device),
    ).toEqual(["desktop"]);
    expect(parsePublicSeoArtifact(raw).pageSpeed).toEqual([]);
  });
  it("only shows Lighthouse diagnostics from a successful referenced sample and binds field data to its device", () => {
    const raw = legacyReport();
    const speed = readings(SEO_TEST_PAGE);
    const lab = speed.mobile.lab;
    for (const invalid of [
      { ...lab, pageSpeed: { ...lab.pageSpeed, sourceRecord: "0".repeat(64) } },
      {
        ...lab,
        sourceRefs: [
          {
            ...lab.sourceRefs[0],
            outcome: { kind: "error", message: "timeout" },
          },
        ],
      },
      { ...lab, sourceRefs: undefined },
    ]) {
      const result = parsePublicSeoArtifact({
        ...raw,
        speed: {
          mobile: {
            lab: invalid,
            field: {
              level: "url",
              url: SEO_TEST_PAGE,
              period: null,
              p75: { lcp: 1000, inp: 90, cls: 0.1, ttfb: null, fcp: null },
              sourceRefs: [
                {
                  port: "crux",
                  request: {
                    port: "crux",
                    url: SEO_TEST_PAGE,
                    device: "desktop",
                  },
                },
              ],
            },
          },
        },
      }).pageSpeed?.[0];
      expect(result?.lab).not.toHaveProperty("pageSpeed.scores");
      expect(result?.field).toEqual({ status: "unavailable" });
    }
  });
  it("does not turn an unsuccessful CrUX origin read into confirmed absence of data", () => {
    const raw = legacyReport();
    const field = {
      none: "no CrUX data for the URL, origin: server unavailable",
      sourceRefs: [
        {
          port: "crux",
          request: { port: "crux", url: SEO_TEST_PAGE, device: "mobile" },
          outcome: { kind: "error", message: "server unavailable" },
        },
      ],
    };
    expect(
      parsePublicSeoArtifact({ ...raw, speed: { mobile: { field } } })
        .pageSpeed?.[0]?.field,
    ).toEqual({ status: "unavailable" });
  });
  it("requires a successful record at the claimed CrUX level when sources exist", () => {
    const raw = legacyReport();
    const page = new URL(SEO_TEST_PAGE);
    const field = {
      level: "url",
      url: SEO_TEST_PAGE,
      period: null,
      p75: { lcp: 1300, inp: 60, cls: 0, ttfb: null, fcp: null },
    };
    const ref = {
      port: "crux",
      request: {
        port: "crux",
        device: "mobile",
        url: SEO_TEST_PAGE,
        params: { kind: "record", level: "url" },
      },
      outcome: { kind: "ok", status: 200 },
    };
    const fieldWith = (source: unknown, result = field) =>
      parsePublicSeoArtifact({
        ...raw,
        speed: { mobile: { field: { ...result, sourceRefs: [source] } } },
      }).pageSpeed?.[0]?.field;
    expect(fieldWith(ref)?.status).toBe("measured");
    expect(
      fieldWith({ ...ref, outcome: { kind: "error", message: "failed" } })
        ?.status,
    ).toBe("unavailable");
    expect(
      fieldWith({
        ...ref,
        request: { ...ref.request, params: { kind: "history", level: "url" } },
      })?.status,
    ).toBe("unavailable");
    expect(
      fieldWith({
        ...ref,
        request: {
          ...ref.request,
          url: page.origin,
          params: { kind: "record", level: "origin" },
        },
      })?.status,
    ).toBe("unavailable");
    const foreign = {
      ...field,
      url: new URL("/other-page", page.origin).href,
      identity: { pageAssessment: "not_determined" },
    };
    expect(fieldWith(ref, foreign)?.status).toBe("unavailable");
    const lab = readings(SEO_TEST_PAGE).mobile.lab;
    expect(
      parsePublicSeoArtifact({
        ...raw,
        speed: {
          mobile: {
            lab: {
              ...lab,
              sourceRefs: [
                {
                  ...lab.sourceRefs[0],
                  outcome: { kind: "error", message: "failed" },
                },
              ],
            },
          },
        },
      }).pageSpeed?.[0]?.lab,
    ).toEqual({ status: "unavailable" });
  });
  it("retains legacy origin field context and does not fabricate a Google score for older lab runs", () => {
    const raw = legacyReport();
    const origin = new URL(SEO_TEST_PAGE).origin;
    const p75 = { lcp: 2000, inp: 111, cls: 0.1, ttfb: null, fcp: 1200 };
    const lab = { runs: 3, ok: 3, median, lighthouse: "13.5.0" };
    const result = parsePublicSeoArtifact({
      ...raw,
      speed: {
        mobile: {
          field: { level: "origin", url: origin, p75, period: null },
          lab,
        },
      },
    });
    expect(result.pageSpeed?.[0]).toEqual({
      pageUrl: SEO_TEST_PAGE,
      testedUrl: SEO_TEST_PAGE,
      device: "mobile",
      field: {
        status: "measured",
        level: "origin",
        url: origin,
        p75,
        period: null,
      },
      lab: { status: "measured", ...lab },
    });
  });
});
