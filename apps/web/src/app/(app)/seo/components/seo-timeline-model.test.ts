import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seoTestWorkspace } from "./seo-test-fixture";
import {
  buildSeoTimeline,
  foldSyncRuns,
  type SeoTimelineNode,
  seoStopDigest,
  seoStops,
} from "./seo-timeline-model";

type Observation = ProjectSeoWorkspace["observations"][number];

function check(id: string, at: string): Observation {
  return {
    id,
    kind: "page_check",
    source: "agent",
    observedAt: new Date(at),
    pageIds: ["home", "pricing"],
    scopeVersion: 2,
    sourceTaskId: `task-${id}`,
    countryCode: "US",
    languageCode: "en",
    devices: ["desktop", "mobile"],
    rulebookVersion: "rules-v1",
    artifactHash: `hash-${id}`,
    issues: 0,
    coverage: { checked: 12, skipped: 2, failed: 0 },
  };
}

function workspaceWithChecks(observations: Observation[]) {
  const workspace = seoTestWorkspace();
  workspace.observations = observations;
  workspace.timeline = observations.map((observation) => ({
    id: observation.id,
    kind: "check",
    title: "Imported",
    detail: "Recorded checks",
    at: new Date("2026-11-06T12:00:00Z"),
    pageIds: observation.pageIds,
    observationId: observation.id,
    taskId: observation.sourceTaskId,
    status: "completed",
  }));
  return workspace;
}

describe("SEO activity graph model", () => {
  it("recognizes a recheck only with earlier compatible evidence, regardless of set order", () => {
    const first = check("first", "2026-11-01T12:00:00Z");
    const second = {
      ...check("second", "2026-11-02T12:00:00Z"),
      pageIds: [...first.pageIds].reverse(),
      devices: [...first.devices].reverse(),
    };
    const workspace = workspaceWithChecks([second, first]);
    expect(buildSeoTimeline(workspace).map((node) => node.label)).toEqual([
      "checkRun",
      "recheckRun",
    ]);
    expect(workspace.observations[0].id).toBe("second");
  });

  it.each<Partial<Observation>>([
    { kind: "rankings" },
    { pageIds: ["home"] },
    { scopeVersion: 3 },
    { countryCode: "DE" },
    { languageCode: "de" },
    { devices: ["mobile"] },
    { rulebookVersion: "rules-v2" },
    { countryCode: null },
    { devices: [] },
    { coverage: { checked: 0, skipped: 0, failed: 12 } },
  ])(
    "does not call incompatible or unavailable evidence a recheck: %j",
    (change) => {
      const workspace = workspaceWithChecks([
        check("first", "2026-11-01T12:00:00Z"),
        { ...check("second", "2026-11-02T12:00:00Z"), ...change },
      ]);
      expect(buildSeoTimeline(workspace).map((node) => node.isRecheck)).toEqual(
        [false, false],
      );
    },
  );

  it("keeps action-link time distinct from its source check and current Task status", () => {
    const observation = check("first", "2026-11-01T12:00:00Z");
    const workspace = workspaceWithChecks([observation]);
    const linkedAt = new Date("2026-11-05T12:00:00Z");
    workspace.timeline.push({
      ...workspace.timeline[0],
      id: "linked-action",
      kind: "action",
      at: linkedAt,
      status: "COMPLETED",
    });
    const action = buildSeoTimeline(workspace)[1];
    expect(action.label).toBe("actionLinked");
    expect(action.at).toBe(linkedAt);
    expect(action.observation).toBeUndefined();
    expect(action.isRecheck).toBe(false);
  });

  it.each(["rankings", "links", "audit_lite", "audit_full"])(
    "does not infer comparable requests for %s from page and market alone",
    (kind) => {
      const workspace = workspaceWithChecks([
        { ...check("first", "2026-11-01T12:00:00Z"), kind },
        { ...check("second", "2026-11-02T12:00:00Z"), kind },
      ]);
      expect(buildSeoTimeline(workspace).every((node) => !node.isRecheck)).toBe(
        true,
      );
    },
  );

  it("does not invent check time when a report is outside the loaded measurement period", () => {
    const workspace = workspaceWithChecks([
      check("first", "2026-11-01T12:00:00Z"),
    ]);
    workspace.observations = [];
    const [event] = buildSeoTimeline(workspace);
    expect(event.label).toBe("resultsSaved");
    expect(event.at).toBe(workspace.timeline[0].at);
    expect(event.isRecheck).toBe(false);
  });
});

describe("foldSyncRuns", () => {
  const node = (
    id: string,
    kind: "metrics" | "check",
    status = "completed",
    title = "Search Console statistics synced",
  ) =>
    ({
      event: { id, kind, status, title },
      observation: undefined,
      at: "2026-11-06T12:00:00Z",
      isRecheck: false,
      label: kind === "metrics" ? "metricsSynced" : "checkRun",
    }) as unknown as SeoTimelineNode;

  it("folds back-to-back syncs and keeps an unavailable sync, another source and a check apart", () => {
    const folded = foldSyncRuns([
      node("s3", "metrics"),
      node("s2", "metrics"),
      node("s1", "metrics", "unavailable"),
      node("a1", "metrics", "unavailable", "Analytics statistics synced"),
      node("c1", "check"),
      node("s0", "metrics"),
    ]);
    expect(folded.map((row) => [row.event.id, row.syncs])).toEqual([
      ["s3", 2],
      ["s1", 1],
      ["a1", 1],
      ["c1", 1],
      ["s0", 1],
    ]);
  });
});

describe("seoStops", () => {
  // West of UTC, so a local day and a UTC day differ in the evening.
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    process.env.TZ = zone;
  });
  // Checks on Nov 3 and Nov 5, a page change on Nov 4 between them and one on Nov 6 after the newest.
  function stops() {
    const workspace = seoTestWorkspace();
    workspace.observations = [
      { ...check("newest", "2026-11-05T10:00:00Z"), issues: 2 },
      { ...check("oldest", "2026-11-03T10:00:00Z"), issues: 1 },
    ];
    const event = (
      id: string,
      kind: ProjectSeoWorkspace["timeline"][number]["kind"],
      at: string,
      observationId: string | null = null,
    ): ProjectSeoWorkspace["timeline"][number] => ({
      id,
      kind,
      title: id,
      detail: "",
      at: new Date(at),
      pageIds: ["home"],
      observationId,
      taskId: null,
      status: kind === "metrics" ? "completed" : "recorded",
    });
    workspace.timeline = [
      event("oldest", "check", "2026-11-03T10:00:00Z", "oldest"),
      event("between", "page_change", "2026-11-04T09:00:00Z"),
      event("newest", "check", "2026-11-05T10:00:00Z", "newest"),
      event("after", "page_change", "2026-11-06T09:00:00Z"),
      // A routine sync is housekeeping: no stop holds it.
      event("sync", "metrics", "2026-11-05T11:00:00Z"),
    ];
    return workspace;
  }
  const ids = (nodes: { event: { id: string } }[]) =>
    nodes.map(({ event }) => event.id);

  it("gives each stop what happened since the stop before; the newest also what came after it", () => {
    const stopsByDay = seoStops(stops(), ["2026-11-05", "2026-11-03"]);
    expect(stopsByDay.get("2026-11-03")?.after).toBeNull();
    expect(ids(stopsByDay.get("2026-11-03")?.nodes ?? [])).toEqual(["oldest"]);
    expect(stopsByDay.get("2026-11-05")?.after).toBe("2026-11-03");
    expect(ids(stopsByDay.get("2026-11-05")?.nodes ?? [])).toEqual([
      "after",
      "newest",
      "between",
    ]);
  });

  it("counts folded clean checks one by one and a request without results not at all", () => {
    const workspace = stops();
    // A clean check of the pages in view folds with the clean check next to it.
    const clean = (id: string, at: string) => ({
      ...check(id, at),
      pageIds: workspace.scope.pageIds,
    });
    workspace.observations.push(
      clean("clean2", "2026-11-05T09:00:00Z"),
      clean("clean1", "2026-11-05T08:00:00Z"),
    );
    const event = (id: string, at: string, observationId: string | null) => ({
      id,
      kind: "check" as const,
      title: id,
      detail: "",
      at: new Date(at),
      pageIds: ["home"],
      observationId,
      taskId: null,
      status: observationId ? "recorded" : "requested",
    });
    workspace.timeline.push(
      event("clean1", "2026-11-05T08:00:00Z", "clean1"),
      event("clean2", "2026-11-05T09:00:00Z", "clean2"),
      event("request", "2026-11-05T12:00:00Z", null),
    );
    const digest = seoStopDigest(
      seoStops(workspace, ["2026-11-05", "2026-11-03"]).get("2026-11-05")
        ?.nodes ?? [],
    );
    expect(digest).toMatchObject({
      checks: 3,
      pageChanges: 2,
      tasks: 0,
      failedSyncs: 0,
    });
    expect(digest.newestCheck?.event.id).toBe("newest");
  });

  it("puts each event on its UTC day and counts what failed, apart from what changed", () => {
    const workspace = stops();
    const event = (
      id: string,
      kind: ProjectSeoWorkspace["timeline"][number]["kind"],
      at: string,
      status: string,
      title = id,
    ): ProjectSeoWorkspace["timeline"][number] => ({
      id,
      kind,
      title,
      detail: "",
      at: new Date(at),
      pageIds: ["home"],
      observationId: null,
      taskId: null,
      status,
    });
    workspace.timeline.push(
      // After the Nov 3 check on its own day: the Nov 3 stop holds it.
      event("late-on-3rd", "page_change", "2026-11-03T20:00:00Z", "recorded"),
      // Late evening west of UTC is the next UTC day: Nov 3 in New York, Nov 4 in UTC.
      event("evening", "page_change", "2026-11-03T23:30:00-05:00", "recorded"),
      event("sync-1", "metrics", "2026-11-05T06:00:00Z", "failed", "Analytics"),
      event("sync-2", "metrics", "2026-11-05T07:00:00Z", "failed", "Analytics"),
      // A sync that lost data is news, not a failure.
      event("sync-gap", "metrics", "2026-11-05T13:00:00Z", "partial", "Ads"),
      event("request", "check", "2026-11-05T14:00:00Z", "failed"),
      // An unavailable check is not a failed one; only a sync that read nothing is.
      event("off", "check", "2026-11-05T14:30:00Z", "unavailable"),
      event("task", "action", "2026-11-05T15:00:00Z", "completed"),
      event("pages", "scope", "2026-11-05T16:00:00Z", "recorded"),
    );
    const stopsByDay = seoStops(workspace, ["2026-11-05", "2026-11-03"]);
    expect(ids(stopsByDay.get("2026-11-03")?.nodes ?? [])).toContain(
      "late-on-3rd",
    );
    const newest = stopsByDay.get("2026-11-05")?.nodes ?? [];
    expect(ids(newest)).toContain("evening");
    expect(ids(newest)).not.toContain("late-on-3rd");
    expect(ids(stopsByDay.get("2026-11-03")?.nodes ?? [])).not.toContain(
      "evening",
    );
    expect(seoStopDigest(newest)).toMatchObject({
      checks: 1,
      failedChecks: 1,
      pageChanges: 3,
      scopeChanges: 1,
      tasks: 1,
      failedSyncs: 2,
    });
  });

  it("gives the oldest stop of the row the days before it", () => {
    const stopsByDay = seoStops(stops(), ["2026-11-05"]);
    expect(stopsByDay.get("2026-11-05")).toMatchObject({
      after: null,
      newest: true,
    });
    expect(ids(stopsByDay.get("2026-11-05")?.nodes ?? [])).toEqual([
      "after",
      "newest",
      "between",
      "oldest",
    ]);
  });
});
