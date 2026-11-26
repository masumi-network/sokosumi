import { describe, expect, it } from "vitest";
import { legacyReport, SEO_TEST_PAGE } from "@/test-fixtures/project-seo";
import {
  parsePublicSeoArtifact,
  publicSeoPayloadSchema,
} from "./project-seo-report";
import { readPageSpeed, scopedPageSpeed } from "./seo-page-speed";

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
        // The stored form has the root slash.
        url: origin + "/",
        p75,
        period: null,
      },
      lab: { status: "measured", ...lab },
    });
  });

  it("reads a Lighthouse version that is not plain as null and keeps the measurement, fresh and stored", () => {
    const leak = "13.6.0-sk-live-abcdef123456";
    const versions = [
      ["13.6.0", "13.6.0"],
      ["12.0.0-beta.1", "12.0.0-beta.1"],
      [leak, null],
      ["1.0-AKIAIOSFODNN7EXAMPLE", null],
      ["v13.6.0", null],
      [`13.${"1".repeat(40)}`, null],
    ] as const;
    for (const [version, expected] of versions) {
      const speed = readings(SEO_TEST_PAGE);
      const fresh = readPageSpeed(
        {
          mobile: {
            ...speed.mobile,
            lab: { ...speed.mobile.lab, lighthouse: version },
          },
        },
        SEO_TEST_PAGE,
      );
      expect(fresh[0]?.lab).toMatchObject({
        status: "measured",
        median,
        lighthouse: expected,
      });
      const result = parsePublicSeoArtifact({ ...legacyReport(), speed });
      const stored = JSON.parse(JSON.stringify(result));
      stored.pageSpeed[0].lab.lighthouse = version;
      expect(
        publicSeoPayloadSchema.parse(stored).pageSpeed?.[0]?.lab,
      ).toMatchObject({
        status: "measured",
        median,
        lighthouse: expected,
      });
    }
  });

  it("drops a stored measurement the row schema refuses and keeps the others and the audit", () => {
    const stored = JSON.parse(
      JSON.stringify(
        parsePublicSeoArtifact({
          ...legacyReport(),
          speed: readings(SEO_TEST_PAGE),
        }),
      ),
    );
    const [valid] = stored.pageSpeed;
    stored.pageSpeed = [valid, { ...valid, lab: { status: "broken" } }];
    const read = publicSeoPayloadSchema.safeParse(stored);
    expect(read.success).toBe(true);
    expect(read.data?.pageSpeed).toEqual([valid]);
  });

  it("reads a measured lab without a Lighthouse version as version null, fresh and stored", () => {
    const speed = readings(SEO_TEST_PAGE);
    const { lighthouse: _, ...lab } = speed.mobile.lab as Record<
      string,
      unknown
    >;
    const fresh = readPageSpeed(
      { mobile: { ...speed.mobile, lab } },
      SEO_TEST_PAGE,
    );
    expect(fresh[0]?.lab).toMatchObject({
      status: "measured",
      lighthouse: null,
    });
    const stored = JSON.parse(
      JSON.stringify(parsePublicSeoArtifact({ ...legacyReport(), speed })),
    );
    delete stored.pageSpeed[0].lab.lighthouse;
    expect(
      publicSeoPayloadSchema.parse(stored).pageSpeed?.[0]?.lab,
    ).toMatchObject({
      status: "measured",
      lighthouse: null,
    });
  });

  it("drops a stored insight the schema refuses and keeps its device and the other insights", () => {
    const stored = JSON.parse(
      JSON.stringify(
        parsePublicSeoArtifact({
          ...legacyReport(),
          speed: readings(SEO_TEST_PAGE),
        }),
      ),
    );
    const row = stored.pageSpeed.find(
      (item: { lab: { pageSpeed?: { insights: unknown[] } } }) =>
        item.lab.pageSpeed?.insights.length,
    );
    const [valid] = row.lab.pageSpeed.insights;
    row.lab.pageSpeed.insights = [
      valid,
      { ...valid, title: "" },
      { ...valid, id: "Unknown" },
      { ...valid, detail: "a".repeat(601) },
    ];
    const read = publicSeoPayloadSchema.parse(stored);
    expect(read.pageSpeed).toHaveLength(stored.pageSpeed.length);
    expect(
      read.pageSpeed?.find((item) => item.device === row.device)?.lab,
    ).toMatchObject({ pageSpeed: { insights: [valid] } });
  });

  it("reads the first 20 stored insights and keeps the device of a longer list", () => {
    const stored = JSON.parse(
      JSON.stringify(
        parsePublicSeoArtifact({
          ...legacyReport(),
          speed: readings(SEO_TEST_PAGE),
        }),
      ),
    );
    const row = stored.pageSpeed.find(
      (item: { lab: { pageSpeed?: { insights: unknown[] } } }) =>
        item.lab.pageSpeed?.insights.length,
    );
    const [valid] = row.lab.pageSpeed.insights;
    row.lab.pageSpeed.insights = Array.from({ length: 21 }, () => valid);
    const read = publicSeoPayloadSchema.parse(stored);
    expect(read.pageSpeed).toHaveLength(stored.pageSpeed.length);
    expect(
      read.pageSpeed?.find((item) => item.device === row.device)?.lab,
    ).toMatchObject({ pageSpeed: { insights: { length: 20 } } });
    // A part of the details Core cannot read goes, as on a fresh import: the device stays.
    const labOf = (details: unknown) => {
      row.lab.pageSpeed = details;
      const kept = publicSeoPayloadSchema
        .parse(stored)
        .pageSpeed?.find((item) => item.device === row.device)?.lab;
      return kept?.status === "measured" ? (kept.pageSpeed ?? "none") : kept;
    };
    const { scores } = row.lab.pageSpeed;
    expect(labOf(null)).toBe("none");
    expect(labOf({ scores, insights: null })).toEqual({ scores, insights: [] });
    expect(labOf({ scores: { performance: 150 }, insights: [valid] })).toEqual({
      scores: {},
      insights: [valid],
    });
    expect(
      labOf({ scores, insights: [valid], measuredAt: "not-a-date" }),
    ).toEqual({ scores, insights: [valid] });
  });

  it("reads a stored collection that is no array as absent and keeps the first 20 measurements", () => {
    const stored = JSON.parse(
      JSON.stringify(
        parsePublicSeoArtifact({
          ...legacyReport(),
          speed: readings(SEO_TEST_PAGE),
        }),
      ),
    );
    const [valid] = stored.pageSpeed;
    const none = publicSeoPayloadSchema.safeParse({
      ...stored,
      pageSpeed: null,
    });
    expect([none.success, none.data?.pageSpeed]).toEqual([true, undefined]);
    const many = publicSeoPayloadSchema.safeParse({
      ...stored,
      pageSpeed: Array.from({ length: 21 }, () => valid),
    });
    expect([many.success, many.data?.pageSpeed?.length]).toEqual([true, 20]);
  });

  it("stores the checked form of a field URL and reads a stored spelling with another host case", () => {
    const books = "https://example.test/books";
    const spelled = "https://EXAMPLE.test/books";
    const p75 = { lcp: 2000, inp: 111, cls: 0.1, ttfb: null, fcp: 1200 };
    const speed = {
      ...readings(books),
      mobile: {
        ...readings(books).mobile,
        field: { level: "url", url: spelled, p75, period: null },
      },
    };
    const result = parsePublicSeoArtifact({
      ...legacyReport(),
      request: { url: books },
      speed,
    });
    const measured = { status: "measured", url: books, p75 };
    expect(readPageSpeed(speed, books)[0]?.field).toMatchObject(measured);
    expect(result.pageSpeed?.[0]).toMatchObject({
      field: measured,
      lab: { status: "measured" },
    });
    const stored = JSON.parse(JSON.stringify(result));
    expect(publicSeoPayloadSchema.parse(stored).pageSpeed).toEqual(
      result.pageSpeed,
    );
    // An audit Core stored with the worker's spelling keeps its field and its lab result.
    stored.pageSpeed[0].field.url = spelled;
    expect(publicSeoPayloadSchema.parse(stored).pageSpeed).toEqual(
      result.pageSpeed,
    );
    // Another path is another URL: the measurement goes, as before.
    stored.pageSpeed[0].field.url = "https://example.test/x/../books";
    expect(
      publicSeoPayloadSchema.parse(stored).pageSpeed?.map((row) => row.device),
    ).toEqual(["desktop"]);
  });
});

describe("CrUX History on a measured field", () => {
  const historyRecord = "d".repeat(64);
  const ref = (kind: string, level = "url", record = "e".repeat(64)) => ({
    record,
    port: "crux",
    request: {
      port: "crux",
      device: "mobile",
      url: SEO_TEST_PAGE,
      params: { kind, level },
    },
    outcome: { kind: "ok", status: 200 },
  });
  const weeks = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      new Date(Date.UTC(2026, 0, 4 + 7 * i)).toISOString().slice(0, 10),
    );
  const points = (days: string[]) =>
    days.map((last, i) => ({ last, p75: i === 1 ? null : 1000 + i }));
  const three = weeks(3);
  const series = {
    lcp: points(three),
    inp: points(three),
    cls: points(three),
    fcp: points(three),
    ttfb: points(three),
  };
  const historyOf = (history: object, sourceRefs: unknown[] | undefined) => {
    const field = parsePublicSeoArtifact({
      ...legacyReport(),
      speed: {
        mobile: {
          field: {
            level: "url",
            url: SEO_TEST_PAGE,
            period: null,
            p75: { lcp: 1300, inp: 60, cls: 0, ttfb: null, fcp: null },
            history: { sourceRecord: historyRecord, reason: null, ...history },
            ...(sourceRefs && { sourceRefs }),
          },
        },
      },
    }).pageSpeed?.[0]?.field;
    return field && "history" in field ? field.history : "no field history";
  };
  const bound = [ref("record"), ref("history", "url", historyRecord)];

  it("keeps the weekly series of the three Core Web Vitals for a comparable, bound history", () => {
    expect(historyOf({ status: "comparable", series }, bound)).toEqual({
      status: "comparable",
      weeks: three,
      lcp: [1000, null, 1002],
      inp: [1000, null, 1002],
      cls: [1000, null, 1002],
    });
  });

  it("shows no series for a population that is not comparable", () => {
    for (const status of ["incompatible_population", "legacy_unverified"])
      expect(historyOf({ status, series }, bound)).toEqual({ status });
  });

  it("shows no series when the history record is not a successful history read at the field's level", () => {
    const refused = { status: "unavailable" };
    for (const refs of [
      [ref("record"), ref("history", "url", "f".repeat(64))],
      [ref("record", "url", historyRecord)],
      [
        ref("record"),
        {
          ...ref("history", "url", historyRecord),
          outcome: { kind: "no-data" },
        },
      ],
    ])
      expect(historyOf({ status: "comparable", series }, refs)).toEqual(
        refused,
      );
    // An origin history read is no history of the URL's own field data. Its request names the origin.
    const origin = ref("history", "origin", historyRecord);
    origin.request.url = new URL(SEO_TEST_PAGE).origin;
    expect(
      historyOf({ status: "comparable", series }, [ref("record"), origin]),
    ).toEqual(refused);
    // A Report from before source references cannot prove the series.
    expect(historyOf({ status: "comparable", series }, undefined)).toEqual({
      status: "legacy_unverified",
    });
  });

  it("keeps the newest 40 weeks and leaves out a metric with unordered, invalid or other weeks", () => {
    const long = weeks(45);
    const read = historyOf(
      {
        status: "comparable",
        series: {
          lcp: points(long),
          inp: points([...long].reverse()),
          cls: points(long.slice(0, 44)),
        },
      },
      bound,
    );
    expect(read).toMatchObject({ status: "comparable", weeks: long.slice(5) });
    expect(read).not.toHaveProperty("inp");
    expect(read).not.toHaveProperty("cls");
    expect(
      historyOf(
        {
          status: "comparable",
          series: {
            lcp: [{ last: "2026-13-45", p75: 1 }],
            inp: [{ last: "2026-01-04", p75: -1 }],
            cls: "x",
          },
        },
        bound,
      ),
    ).toEqual({ status: "unavailable" });
  });

  it("keeps the status of a bound, comparable history that has no series", () => {
    expect(historyOf({ status: "comparable" }, bound)).toEqual({
      status: "comparable",
    });
    expect(historyOf({ status: "comparable" }, [ref("record")])).toEqual({
      status: "unavailable",
    });
  });

  it("refuses a week that is no calendar date", () => {
    expect(
      historyOf(
        {
          status: "comparable",
          series: { lcp: [{ last: "2026-02-31", p75: 1300 }] },
        },
        bound,
      ),
    ).toEqual({ status: "unavailable" });
  });

  it("reads a series that is no object as an unavailable history", () => {
    for (const broken of ["broken", 42, [], false])
      expect(
        historyOf({ status: "comparable", series: broken }, bound),
      ).toEqual({ status: "unavailable" });
    expect(historyOf({ status: "comparable", series: null }, bound)).toEqual({
      status: "comparable",
    });
  });

  it("reads a series that is no object as unavailable in a Report without source references", () => {
    for (const broken of [false, "broken", []])
      expect(
        historyOf({ status: "comparable", series: broken }, undefined),
      ).toEqual({ status: "unavailable" });
    for (const readable of [{}, { series }, { series: null }])
      expect(
        historyOf({ status: "comparable", ...readable }, undefined),
      ).toEqual({ status: "legacy_unverified" });
  });

  it("reads a stored series that is no object as an unavailable history and keeps the measurement", () => {
    const stored = JSON.parse(
      JSON.stringify(
        parsePublicSeoArtifact({
          ...legacyReport(),
          speed: {
            mobile: {
              field: {
                level: "url",
                url: SEO_TEST_PAGE,
                period: null,
                p75: { lcp: 1300, inp: 60, cls: 0, ttfb: null, fcp: null },
                history: {
                  status: "comparable",
                  sourceRecord: historyRecord,
                  series,
                },
                sourceRefs: bound,
              },
            },
          },
        }),
      ),
    );
    for (const broken of [false, "broken", 42, []]) {
      stored.pageSpeed[0].field.history = {
        status: "comparable",
        series: broken,
      };
      expect(
        publicSeoPayloadSchema.parse(stored).pageSpeed?.[0]?.field,
      ).toMatchObject({
        status: "measured",
        p75: { lcp: 1300 },
        history: { status: "unavailable" },
      });
    }
    // No series is the answer of a read that gave none.
    stored.pageSpeed[0].field.history = { status: "comparable", series: null };
    expect(
      publicSeoPayloadSchema.parse(stored).pageSpeed?.[0]?.field,
    ).toMatchObject({ history: { status: "comparable" } });
    // Weeks that are not oldest first would turn the trend around: the history goes.
    for (const weeks of [[...three].reverse(), [three[0], three[0]]]) {
      stored.pageSpeed[0].field.history = { status: "comparable", weeks };
      const field = publicSeoPayloadSchema.parse(stored).pageSpeed?.[0]?.field;
      expect(field).toMatchObject({ status: "measured", p75: { lcp: 1300 } });
      expect(field).not.toHaveProperty("history");
    }
    stored.pageSpeed[0].field.history = { status: "comparable", weeks: three };
    expect(
      publicSeoPayloadSchema.parse(stored).pageSpeed?.[0]?.field,
    ).toMatchObject({ history: { weeks: three } });
    // Only a comparable history holds a series, and a metric has one value per week.
    const historyOfStored = (history: object) => {
      stored.pageSpeed[0].field.history = history;
      const field = publicSeoPayloadSchema.parse(stored).pageSpeed?.[0]?.field;
      return field && "history" in field ? field.history : "none";
    };
    expect(
      historyOfStored({
        status: "incompatible_population",
        weeks: three,
        lcp: [1, 2, 3],
      }),
    ).toEqual({ status: "incompatible_population" });
    expect(
      historyOfStored({
        status: "comparable",
        weeks: three,
        lcp: [1, 2, 3],
        inp: [1, 2],
      }),
    ).toEqual({ status: "comparable", weeks: three, lcp: [1, 2, 3] });
    expect(historyOfStored({ status: "comparable", lcp: [1, 2, 3] })).toEqual({
      status: "comparable",
    });
    // Field data of another host is no data of the tested page; a tested page of another host is no measurement.
    delete stored.pageSpeed[0].field.history;
    stored.pageSpeed[0].field.url = "https://other.test/books";
    expect(publicSeoPayloadSchema.parse(stored).pageSpeed?.[0]?.field).toEqual({
      status: "unavailable",
    });
    stored.pageSpeed[0].field.url = SEO_TEST_PAGE;
    stored.pageSpeed[0].testedUrl = "https://other.test/books";
    expect(
      publicSeoPayloadSchema
        .parse(stored)
        .pageSpeed?.some((row) => row.testedUrl.includes("other.test")),
    ).toBe(false);
  });

  it("drops a stored history it cannot read and keeps the measurement and the audit", () => {
    const stored = JSON.parse(
      JSON.stringify(
        parsePublicSeoArtifact({
          ...legacyReport(),
          speed: {
            mobile: {
              field: {
                level: "url",
                url: SEO_TEST_PAGE,
                period: null,
                p75: { lcp: 1300, inp: 60, cls: 0, ttfb: null, fcp: null },
                history: {
                  status: "comparable",
                  sourceRecord: historyRecord,
                  series,
                },
                sourceRefs: bound,
              },
            },
          },
        }),
      ),
    );
    expect(stored.pageSpeed[0].field.history.weeks).toEqual(three);
    // The second value has the form of a day and is no calendar day.
    for (const weeks of [["2026-1-4"], ["2026-02-31"]]) {
      stored.pageSpeed[0].field.history.weeks = weeks;
      stored.siteSpeed = {
        rows: [
          {
            url: SEO_TEST_PAGE,
            audited: false,
            devices: [stored.pageSpeed[0]],
          },
        ],
        dropped: 0,
      };
      const read = publicSeoPayloadSchema.safeParse(stored);
      expect(read.success).toBe(true);
      for (const field of [
        read.data?.pageSpeed?.[0]?.field,
        read.data?.siteSpeed?.rows[0]?.devices[0]?.field,
      ]) {
        expect(field).toMatchObject({ status: "measured", p75: { lcp: 1300 } });
        expect(field).not.toHaveProperty("history");
      }
    }
  });
});
