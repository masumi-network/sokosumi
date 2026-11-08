import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { seoTestWorkspace } from "./seo-test-fixture";
import {
  buildSeoTimeline,
  foldSyncRuns,
  type SeoTimelineNode,
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
