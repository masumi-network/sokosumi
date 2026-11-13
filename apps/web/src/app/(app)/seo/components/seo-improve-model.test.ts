import { readdirSync, readFileSync } from "node:fs";
import {
  SEO_CAPABILITIES,
  SEO_STATISTICS_ANALYTICS_NO_AGGREGATE_NOTE,
  SEO_STATISTICS_ANALYTICS_THRESHOLDING_NOTE,
  SEO_STATISTICS_ANALYTICS_TIME_ZONE_NOTE,
  SEO_STATISTICS_ANALYTICS_TRUNCATED_NOTE,
  SEO_STATISTICS_QUERY_FAILED_NOTE,
  SEO_STATISTICS_QUERY_ROWS_ANONYMIZED_NOTE,
  SEO_STATISTICS_QUERY_ROWS_UNAVAILABLE_NOTE,
  SEO_STATISTICS_SEARCH_CONSOLE_FINAL_DATA_NOTE,
  seoStatisticsKeywordRowsCutNote,
  seoStatisticsKeywordsLeftOutNote,
  seoStatisticsQueryRowsCutNote,
} from "@sokosumi/utils";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import de from "../../../../../messages/de.json";
import messages from "../../../../../messages/en.json";
import es from "../../../../../messages/es.json";
import {
  seoAuditGaps,
  seoAuditGapValues,
  seoCapabilityGroups,
  seoUnlockSteps,
  seoViewNarrowed,
} from "./seo-improve-model";
import {
  seoTestMetric,
  seoTestObservation,
  seoTestWorkspace,
} from "./seo-test-fixture";

describe("seoCapabilityGroups", () => {
  it("lists every item not built, in the doc's groups and order", () => {
    const groups = seoCapabilityGroups("all");
    const ids = groups.flatMap((group) => group.items.map((item) => item.id));
    expect(ids).not.toContain(34);
    expect(ids).toHaveLength(
      SEO_CAPABILITIES.filter((item) => item.status !== "built").length,
    );
    expect(groups.map((group) => group.group)).toEqual([
      "technical",
      "content",
      "keywords",
      "links",
      "local",
      "measurement",
      "ai",
      "workflow",
    ]);
  });

  it("keeps one status under a filter and drops a group left empty", () => {
    const catalog = [
      { ...SEO_CAPABILITIES[0], status: "partial" as const },
      { ...SEO_CAPABILITIES[3], status: "missing" as const },
      { ...SEO_CAPABILITIES[21], status: "planned" as const },
    ];
    expect(seoCapabilityGroups("missing", catalog)).toEqual([
      { group: "technical", items: [catalog[1]] },
    ]);
    expect(
      seoCapabilityGroups("all", catalog).map((group) => group.group),
    ).toEqual(["technical", "keywords"]);
  });
});

describe("seoAuditGaps", () => {
  it("asks a new audit to connect both sources and to run a first check", () => {
    expect(seoAuditGaps(seoTestWorkspace())).toEqual([
      { message: "noSearchConsole", fix: "connect_search_console" },
      { message: "noAnalytics", fix: "connect_ga4" },
      { message: "noCheck", fix: "run_check" },
    ]);
  });

  it("does not claim that no check ran where dates or a cut history hide checks", () => {
    const dated = seoTestWorkspace();
    dated.scope = { ...dated.scope, from: "2026-01-01" };
    const cut = seoTestWorkspace();
    cut.history = { limit: 200, limited: true };
    for (const workspace of [dated, cut])
      expect(seoAuditGaps(workspace).map((gap) => gap.message)).not.toContain(
        "noCheck",
      );
  });

  it("names a sync that read nothing, not the empty statistics of a new audit", () => {
    const fresh = seoTestWorkspace();
    fresh.metricsStatus = "unavailable";
    expect(seoAuditGaps(fresh).map((gap) => gap.message)).not.toContain(
      "statisticsUnavailable",
    );
    const empty = seoTestWorkspace();
    empty.metrics = [{ ...seoTestMetric(), coverage: "unavailable" }];
    empty.metricsStatus = "partial";
    expect(seoAuditGaps(empty)).toContainEqual({
      message: "statisticsUnavailable",
      fix: "sync",
    });
  });

  it("claims no missing source where a filter narrows the statistics", () => {
    for (const filters of [
      { channel: "all" },
      { pageId: "page" },
      { scopeId: "scope" },
    ]) {
      const narrowed = seoViewNarrowed(filters);
      expect(narrowed).toBe(true);
      const workspace = seoTestWorkspace();
      expect(
        seoAuditGaps(workspace, narrowed).map((gap) => gap.message),
      ).toEqual(["noCheck"]);
      for (const step of seoUnlockSteps(workspace, narrowed).filter(
        (step) => step.unlock === "search_console" || step.unlock === "ga4",
      ))
        expect(step).toEqual(
          expect.objectContaining({ done: false, connect: null }),
        );
    }
    expect(
      seoViewNarrowed({ channel: null, pageId: null, scopeId: null }),
    ).toBe(false);
  });

  it("offers no fix the reader cannot take", () => {
    const workspace = seoTestWorkspace();
    workspace.availableActions = {
      ...workspace.availableActions,
      canSyncMetrics: false,
      canRequestAnalysis: false,
    };
    expect(seoAuditGaps(workspace).map((gap) => gap.fix)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("skips routine notes and the cut-rows note, and names every other note Core writes", () => {
    const workspace = seoTestWorkspace();
    workspace.metrics = [
      {
        ...seoTestMetric(),
        notes: [
          SEO_STATISTICS_SEARCH_CONSOLE_FINAL_DATA_NOTE,
          SEO_STATISTICS_QUERY_ROWS_ANONYMIZED_NOTE,
          seoStatisticsQueryRowsCutNote(500),
          seoStatisticsKeywordRowsCutNote(25000),
          seoStatisticsKeywordsLeftOutNote(["kw (US)", "kw (DE)"], 25, 3),
        ],
      },
      {
        ...seoTestMetric(),
        id: "ga4:sessions",
        key: "sessions",
        source: "ga4",
        propertyId: "properties/1",
        channel: "organic",
        notes: [
          SEO_STATISTICS_QUERY_FAILED_NOTE,
          SEO_STATISTICS_ANALYTICS_TIME_ZONE_NOTE,
          SEO_STATISTICS_ANALYTICS_NO_AGGREGATE_NOTE,
          SEO_STATISTICS_ANALYTICS_THRESHOLDING_NOTE,
          SEO_STATISTICS_ANALYTICS_TRUNCATED_NOTE,
        ],
      },
    ];
    expect(seoAuditGaps(workspace).filter((gap) => gap.fix === "sync")).toEqual(
      [
        { message: "keywordRowsCut", count: 25000, fix: "sync" },
        {
          message: "keywordsLeftOut",
          count: 2,
          names: ["kw (US)", "kw (DE)"],
          fix: "sync",
        },
        { message: "queryFailed", fix: "sync" },
        { message: "analyticsTimeZone", fix: "sync" },
        { message: "analyticsNoAggregate", fix: "sync" },
        { message: "analyticsThresholding", fix: "sync" },
        { message: "analyticsTruncated", fix: "sync" },
      ],
    );
  });

  it("reads the notes of the latest sync, the cut rows and the newest check only", () => {
    const workspace = seoTestWorkspace();
    workspace.metrics = [
      {
        ...seoTestMetric(),
        notes: [SEO_STATISTICS_QUERY_ROWS_UNAVAILABLE_NOTE, "A new note."],
      },
      // An older sync of the same source: its note is no longer news.
      {
        ...seoTestMetric(),
        id: "old:clicks",
        observedAt: new Date("2025-12-01T00:00:00Z"),
        notes: ["An old note."],
      },
    ];
    workspace.searchQueries = {
      observationId: "sync",
      propertyId: "sc-domain:example.com",
      from: "2026-01-01",
      to: "2026-01-02",
      timeZone: "UTC",
      observedAt: new Date("2026-01-03T00:00:00Z"),
      rowLimit: 500,
      truncated: true,
      rows: [],
    };
    const check = seoTestObservation(workspace);
    workspace.observations = [
      // A sync has no tests and is not the newest check.
      {
        ...check,
        id: "sync",
        coverage: { checked: 0, skipped: 0, failed: 0 },
      },
      {
        ...check,
        coverage: {
          checked: 10,
          skipped: 2,
          failed: 1,
          modules: {
            notRequested: 1,
            failed: 1,
            notRequestedNames: ["links.refresh"],
            failedNames: ["keyword.refresh"],
          },
        },
      },
      {
        ...check,
        id: "older",
        coverage: { checked: 1, skipped: 9, failed: 9 },
      },
    ];
    workspace.availableActions.canUsePaidSearchData = false;
    workspace.history = { limit: 200, limited: true };
    expect(seoAuditGaps(workspace)).toEqual([
      { message: "noAnalytics", fix: "connect_ga4" },
      { message: "queryRows", fix: "sync" },
      { message: "note", note: "A new note.", fix: "sync" },
      { message: "queriesTruncated", count: 500, fix: null },
      { message: "notChecked", count: 2, fix: "run_check" },
      { message: "failed", count: 1, fix: "run_check" },
      {
        message: "modulesNotRequested",
        names: ["links.refresh"],
        fix: "run_check",
      },
      {
        message: "modulesFailed",
        names: ["keyword.refresh"],
        fix: "run_check",
      },
      { message: "paidOff", fix: null },
      { message: "historyLimited", count: 200, fix: null },
    ]);
  });
});

describe("seoUnlockSteps", () => {
  it("marks a connected source done and offers to connect the other", () => {
    const workspace = seoTestWorkspace();
    workspace.metrics = [seoTestMetric()];
    const steps = seoUnlockSteps(workspace);
    expect(steps.find((step) => step.unlock === "search_console")).toEqual(
      expect.objectContaining({ done: true, connect: null }),
    );
    expect(steps.find((step) => step.unlock === "ga4")).toEqual(
      expect.objectContaining({ done: false, connect: "connect_ga4" }),
    );
  });

  it("counts the open items of a step and leaves out a step with none", () => {
    const steps = seoUnlockSteps(seoTestWorkspace(), false, [
      { ...SEO_CAPABILITIES[0], unlocks: ["paid_data", "development"] },
      { ...SEO_CAPABILITIES[33], unlocks: ["paid_data"] },
    ]);
    expect(steps.map((step) => [step.unlock, step.items])).toEqual([
      ["paid_data", 1],
      ["development", 1],
    ]);
  });
});

describe("Item 38", () => {
  it("names each section table that has no CSV download", () => {
    // A Table inside a section is a data table; a folded <table> beside a chart is its text alternative.
    const dir = new URL(".", import.meta.url);
    const withoutCsv = readdirSync(dir)
      .filter((file) => file.endsWith(".tsx") && !file.includes(".test."))
      .filter((file) => {
        const source = readFileSync(new URL(file, dir), "utf8");
        return (
          /<Table[\s>]/.test(source) &&
          source.includes("<SeoSection") &&
          !source.includes("<SeoCsvButton")
        );
      });
    const names: Record<string, string> = {
      "seo-breakdown.tsx": "countries and devices",
      "seo-competitors.tsx": "competitors",
      "seo-keyword-ideas.tsx": "keyword ideas",
    };
    expect(withoutCsv.sort()).toEqual(Object.keys(names).sort());
    const missing = SEO_CAPABILITIES.find((item) => item.id === 38)?.missing;
    for (const name of Object.values(names)) expect(missing).toContain(name);
    // seoCsv picks the separator from the app language; Excel reads the computer's region.
    expect(missing).toContain("separator follows the app language");
  });
});

describe("Improve messages", () => {
  it("say how many left-out keywords a cut note did not name, and drop an empty list", () => {
    const say = (
      locale: string,
      source: typeof messages,
      names: string[],
      count: number,
    ) =>
      createTranslator({
        locale,
        messages: source,
        namespace: "App.Seo.improve.gaps",
      })(
        "keywordsLeftOut",
        seoAuditGapValues(
          { message: "keywordsLeftOut", names, count, fix: null },
          (list) => list.join(", "),
        ),
      );
    const cases = [
      [
        "en",
        messages,
        "for 5 tracked keywords: a, b and 3 more.",
        "for 1 tracked keyword.",
      ],
      ["de", de, "Keywords: a, b und 3 weitere.", "Keyword."],
      ["es", es, "seguidas: a, b y 3 más.", "seguida."],
    ] as const;
    for (const [locale, source, cut, empty] of cases) {
      expect(say(locale, source, ["a", "b"], 5)).toContain(cut);
      expect(say(locale, source, [], 1).endsWith(empty)).toBe(true);
      expect(say(locale, source, ["a", "b"], 2)).toMatch(/: a, b\.$/);
    }
  });

  it("start each button's accessible name with its visible text (WCAG 2.5.3)", () => {
    for (const { App } of [messages, de, es]) {
      const seo = App.Seo;
      for (const [visible, label] of [
        [seo.export.csv, seo.export.csvLabel],
        [seo.improve.ask, seo.improve.askLabel],
        [seo.improve.request, seo.improve.requestLabel],
      ])
        expect(label.startsWith(visible), label).toBe(true);
    }
  });

  it("say each item in English as the catalog does", () => {
    const items = messages.App.Seo.improve.items as Record<
      string,
      { title: string; missing: string }
    >;
    for (const item of SEO_CAPABILITIES)
      expect(items[String(item.id)], `item ${item.id}`).toEqual({
        title: item.title,
        missing: item.missing ?? "",
      });
  });
});
