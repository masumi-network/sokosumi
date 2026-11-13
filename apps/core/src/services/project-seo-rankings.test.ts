import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { parsePublicSeoArtifact } from "@/helpers/project-seo-report";
import {
  SEO_RANK_HISTORY_POINTS,
  SEO_SERP_SERIES_MAX,
} from "@/schemas/project-seo-rankings.schema";
import {
  focusedRankingsReport,
  SEO_TEST_PAGE,
  SEO_TEST_SECOND_PAGE,
  serpRead,
} from "@/test-fixtures/project-seo";

import { projectSeoProjection } from "./project-seo-projection";
import { withSeoRankings } from "./project-seo-rankings";

type Input = Parameters<typeof projectSeoProjection>[0];
type Read = { position: number | null; status?: string; device?: string };

const at = (day: number) =>
  new Date(Date.UTC(2026, 9, 1 + day, 9)).toISOString();

/** A rankings result of one day: each read is a keyword row of the first test page. */
function result(day: number, reads: Read[], extra: object = {}) {
  const base = focusedRankingsReport();
  const raw = {
    ...base,
    observedAt: at(day),
    scope: { ...base.scope, devices: ["mobile", "desktop"] },
    keywords: reads.map((read) => ({
      ...base.keywords[0],
      device: read.device ?? "desktop",
      position: read.position,
      positionStatus:
        read.status ?? (read.position === null ? "not_in_range" : "ranked"),
      observedAt: at(day),
    })),
    serps: [],
    ...extra,
  };
  return parsePublicSeoArtifact(raw);
}

function input(pageUrls = [SEO_TEST_PAGE]): Input {
  const now = new Date(at(0)),
    projectId = randomUUID();
  const pages = pageUrls.map((url) => ({
    id: randomUUID(),
    projectId,
    auditId: null,
    url,
    label: "",
    relationship: "primary",
    relatedToPageId: null,
    createdAt: now,
    updatedAt: now,
  }));
  const pageIds = pages.slice(0, 1).map((page) => page.id);
  return {
    project: {
      id: projectId,
      websiteUrl: SEO_TEST_PAGE,
      closingAt: null,
      closedAt: null,
    },
    scope: { id: null, name: "All", version: 0, pageIds, pages: [pages[0]] },
    query: {},
    pages,
    scopes: [],
    observations: [],
    keywords: [],
    competitors: [],
    analyses: [],
    actionTasks: [],
    tasks: [],
    privateMetricsAllowed: false,
  };
}

function observation(
  base: Input,
  payload: ReturnType<typeof result>,
): Input["observations"][number] {
  return {
    id: randomUUID(),
    projectId: base.project.id,
    auditId: null,
    kind: payload.kind,
    source: "seo_coworker",
    sourceKey: randomUUID(),
    sourceTaskId: null,
    sourceFileId: null,
    ownerId: null,
    visibility: "PRIVATE",
    pageIds: base.scope.pageIds,
    scopeVersion: 0,
    artifactHash: "hash",
    payload,
    observedAt: new Date(payload.observedAt),
    createdAt: new Date(payload.observedAt),
  };
}

/** The workspace and its history, from results newest first as the service loads them. */
function workspaceOf(
  results: ReturnType<typeof result>[],
  base = input(),
  history = results,
) {
  const rows = results.map((payload) => observation(base, payload));
  const historyRows =
    history === results
      ? rows
      : history.map((payload) => observation(base, payload));
  return withSeoRankings(
    projectSeoProjection({ ...base, observations: rows }),
    historyRows,
  );
}

describe("keyword position history", () => {
  it("keeps every paid read oldest first, a read outside the checked results included", () => {
    const workspace = workspaceOf([
      result(3, [{ position: 3 }]),
      result(2, [{ position: null }]),
      result(1, [{ position: 5 }]),
    ]);
    expect(workspace.keywords).toHaveLength(1);
    expect(
      workspace.keywords[0].positionHistory?.map((point) => [
        point.observedAt,
        point.position,
        point.positionStatus,
      ]),
    ).toEqual([
      [at(1), 5, "ranked"],
      [at(2), null, "not_in_range"],
      [at(3), 3, "ranked"],
    ]);
  });

  it("keeps one series per device and per Market", () => {
    const workspace = workspaceOf([
      result(2, [{ position: 4 }, { position: 9, device: "mobile" }]),
      result(1, [{ position: 6 }], {
        scope: { ...focusedRankingsReport().scope, countryCode: "DE" },
      }),
      result(0, [{ position: 7 }]),
    ]);
    const series = Object.fromEntries(
      workspace.keywords.map((row) => [
        `${row.device}:${row.countryCode}`,
        row.positionHistory?.map((point) => point.position),
      ]),
    );
    expect(series).toEqual({
      "desktop:US": [7, 4],
      "mobile:US": [9],
      "desktop:DE": [6],
    });
  });

  it("reads history beyond the workspace load, and only for the selected page", () => {
    const newest = result(5, [{ position: 2 }]);
    const older = Array.from({ length: 4 }, (_, day) =>
      result(day, [{ position: 10 - day }]),
    ).reverse();
    const base = input([SEO_TEST_PAGE, SEO_TEST_SECOND_PAGE]);
    const otherPage = {
      ...result(4, [{ position: 1 }]),
      keywords: [
        {
          ...result(4, [{ position: 1 }]).keywords[0],
          pageUrl: SEO_TEST_SECOND_PAGE,
        },
      ],
    };
    // The workspace load holds the newest result only.
    const workspace = workspaceOf([newest], base, [
      newest,
      otherPage,
      ...older,
    ]);
    expect(
      workspace.keywords[0].positionHistory?.map((point) => point.position),
    ).toEqual([10, 9, 8, 7, 2]);
  });

  it("keeps the newest points when the reads pass the limit", () => {
    const results = Array.from(
      { length: SEO_RANK_HISTORY_POINTS + 5 },
      (_, day) => result(day, [{ position: (day % 50) + 1 }]),
    ).reverse();
    const history = workspaceOf(results).keywords[0].positionHistory ?? [];
    expect(history).toHaveLength(SEO_RANK_HISTORY_POINTS);
    expect(history.at(0)?.observedAt).toBe(at(5));
    expect(history.at(-1)?.observedAt).toBe(at(SEO_RANK_HISTORY_POINTS + 4));
  });

  it("follows the period of the workspace", () => {
    const base = input();
    const workspace = workspaceOf(
      [result(3, [{ position: 3 }]), result(1, [{ position: 5 }])],
      { ...base, query: { from: at(2).slice(0, 10) } },
    );
    expect(
      workspace.keywords[0].positionHistory?.map((point) => point.position),
    ).toEqual([3]);
  });
});

describe("SERP feature history", () => {
  const serps = (day: number, rows: Record<string, unknown>[]) => ({
    serps: rows.map((row) => serpRead({ observedAt: at(day), ...row })),
  });

  it("keeps one series per keyword, device and Market, oldest first, with not-checked and suspect reads as they are", () => {
    const { serpHistory } = workspaceOf([
      result(
        2,
        [{ position: 3 }],
        serps(2, [
          { keyword: "Example", aiOverview: null },
          // A suspect read carries no SERP data (seo-bot serpEntry).
          {
            device: "mobile",
            suspect: true,
            itemTypes: [],
            aiOverview: null,
            featured: null,
            paaOwned: false,
            top: [],
          },
        ]),
      ),
      result(1, [{ position: 5 }], serps(1, [{}])),
    ]);
    expect(
      serpHistory?.map((entry) => [
        entry.keyword,
        entry.device,
        entry.points.map((point) => [
          point.observedAt,
          point.aiOverview?.pageCited ?? null,
          point.suspect,
        ]),
      ]),
    ).toEqual([
      [
        "example",
        "desktop",
        [
          [at(1), true, false],
          [at(2), null, false],
        ],
      ],
      ["example", "mobile", [[at(2), null, true]]],
    ]);
  });

  it("has no series for results from before SERP reads", () => {
    const old = result(1, [{ position: 5 }]);
    delete old.serps;
    expect(workspaceOf([old]).serpHistory).toEqual([]);
  });

  it("keeps the series with the newest reads when they pass the cap", () => {
    const many = (day: number, from: number, count: number) =>
      serps(
        day,
        Array.from({ length: count }, (_, index) => ({
          keyword: `keyword ${from + index}`,
        })),
      );
    const { serpHistory } = workspaceOf([
      result(2, [{ position: 1 }], many(2, 0, 10)),
      result(1, [{ position: 1 }], many(1, 10, SEO_SERP_SERIES_MAX)),
    ]);
    expect(serpHistory).toHaveLength(SEO_SERP_SERIES_MAX);
    expect(serpHistory?.slice(0, 10).map((entry) => entry.keyword)).toEqual(
      Array.from({ length: 10 }, (_, index) => `keyword ${index}`),
    );
  });
});
