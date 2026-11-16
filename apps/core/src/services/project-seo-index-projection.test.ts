import { randomUUID } from "node:crypto";
import type { ProjectSeoObservation } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { newestIndexTriage } from "./project-seo-index-projection";

const PAGE = "https://example.com/";
const OTHER = "https://example.com/related";
const CHECKED_AT = "2026-11-16T10:00:00.000Z";
function row(): ProjectSeoObservation {
  return {
    id: randomUUID(),
    projectId: randomUUID(),
    auditId: null,
    kind: "index_triage",
    source: "seo_worker",
    sourceKey: "task-index-triage:task_1",
    sourceTaskId: "task_1",
    sourceFileId: null,
    ownerId: "user_1",
    visibility: "PRIVATE",
    pageIds: [randomUUID()],
    scopeVersion: 1,
    artifactHash: "a".repeat(64),
    observedAt: new Date(CHECKED_AT),
    createdAt: new Date(CHECKED_AT),
    payload: {
      version: 1,
      taskId: "task_1",
      receiptHash: "a".repeat(64),
      checkedAt: CHECKED_AT,
      assessments: [PAGE, OTHER].map((pageUrl) => ({
        pageUrl,
        status: "review",
        report: false,
        reason: "Confirm indexing intent",
        suggestedFix: "Keep a deliberate exclusion",
        evidence: [],
      })),
    },
  };
}

describe("private SEO indexing projection", () => {
  it("shows only selected pages from the latest assessed Task", () => {
    const observation = row();
    const result = newestIndexTriage([observation], new Set([OTHER]));
    expect(result).toMatchObject({ taskId: "task_1", checkedAt: CHECKED_AT });
    expect(result?.assessments.map((page) => page.pageUrl)).toEqual([OTHER]);
    expect(
      newestIndexTriage([observation], new Set(["https://another.test/"])),
    ).toBeNull();
  });

  it("refuses public, unowned, malformed and detached Task assessments", () => {
    const observation = row();
    for (const invalid of [
      { ...observation, visibility: "SHARED" },
      { ...observation, ownerId: null },
      { ...observation, sourceTaskId: "different_task" },
      { ...observation, payload: {} },
    ])
      expect(newestIndexTriage([invalid], new Set([PAGE]))).toBeNull();
  });
});
