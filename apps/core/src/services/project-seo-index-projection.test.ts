import { randomUUID } from "node:crypto";
import type { ProjectSeoObservation } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  indexAuditFindings,
  newestIndexTriage,
  withIndexIssueCounts,
} from "./project-seo-index-projection";

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

function auditRow(): ProjectSeoObservation {
  return {
    ...row(),
    ownerId: null,
    kind: "audit_full",
    source: "seo_coworker",
    payload: {
      version: 1,
      kind: "audit_full",
      requestId: null,
      pageUrls: [PAGE, OTHER],
      observedAt: CHECKED_AT,
      countryCode: "US",
      languageCode: "en",
      rulebookVersion: "test",
      checks: [],
      keywords: [],
      competitors: [],
      findings: [],
      actions: [],
      coverage: { checked: 0, skipped: 0, failed: 0 },
      notes: [],
    },
  };
}
function issueRow() {
  const observation = row();
  const payload = observation.payload as {
    assessments: Array<{ status: string; report: boolean }>;
  };
  payload.assessments[0].status = "issue";
  payload.assessments[0].report = true;
  return observation;
}

describe("private SEO indexing projection", () => {
  it("shows only selected pages from the latest assessed Task", () => {
    const observation = row();
    const result = newestIndexTriage([observation], new Set([OTHER]));
    expect(result?.assessments[0]).toMatchObject({
      taskId: "task_1",
      checkedAt: CHECKED_AT,
    });
    expect(result?.assessments.map((page) => page.pageUrl)).toEqual([OTHER]);
    expect(
      newestIndexTriage([observation], new Set(["https://another.test/"])),
    ).toBeNull();
  });

  it("keeps a related page's review from its own Task when the primary page has a newer indexed result", () => {
    const older = row();
    const newer = row();
    newer.sourceTaskId = "task_2";
    newer.payload = {
      version: 1,
      taskId: "task_2",
      receiptHash: "b".repeat(64),
      checkedAt: "2026-11-16T11:00:00.000Z",
      assessments: [
        {
          pageUrl: PAGE,
          status: "indexed",
          report: false,
          reason: "Indexed",
          suggestedFix: null,
          evidence: [],
        },
      ],
    };
    const result = newestIndexTriage(
      [newer, older],
      new Set([PAGE, OTHER]),
      new Map([
        [PAGE, "task_2"],
        [OTHER, "task_1"],
      ]),
    );
    expect(
      result?.assessments.map((page) => [
        page.pageUrl,
        page.status,
        page.taskId,
        page.checkedAt,
      ]),
    ).toEqual([
      [PAGE, "indexed", "task_2", "2026-11-16T11:00:00.000Z"],
      [OTHER, "review", "task_1", CHECKED_AT],
    ]);
  });

  it("refuses public, unowned, malformed and detached Task assessments", () => {
    const observation = row();
    for (const invalid of [
      { ...observation, visibility: "SHARED" },
      { ...observation, ownerId: null },
      { ...observation, source: "unrelated_source" },
      { ...observation, sourceTaskId: "different_task" },
      { ...observation, payload: {} },
    ])
      expect(newestIndexTriage([invalid], new Set([PAGE]))).toBeNull();
  });

  it("puts Console issues and their fixes into the associated audit and counts them once", () => {
    const audit = auditRow();
    const result = indexAuditFindings(
      [issueRow()],
      [audit],
      new Set([PAGE, OTHER]),
      {},
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      observationId: audit.id,
      pageUrl: PAGE,
      rowId: "AC-20",
      suggestedFix: "Keep a deliberate exclusion",
    });
    expect(
      withIndexIssueCounts([{ id: audit.id, issues: 2 }], result.counts)[0]
        .issues,
    ).toBe(3);
    expect(
      withIndexIssueCounts(
        [{ observationId: audit.id, issues: null }],
        result.counts,
      )[0].issues,
    ).toBeNull();
    expect(
      indexAuditFindings([issueRow()], [audit], new Set([OTHER]), {}).findings,
    ).toEqual([]);
    expect(
      indexAuditFindings([], [audit], new Set([PAGE]), {}).findings,
    ).toEqual([]);
  });

  it("does not carry an older Console fault into a new audit or another audit date", () => {
    const old = auditRow();
    const newer = {
      ...auditRow(),
      sourceTaskId: "task_2",
      observedAt: new Date("2026-11-17T10:00:00Z"),
    };
    expect(
      indexAuditFindings([issueRow()], [newer, old], new Set([PAGE]), {})
        .findings,
    ).toEqual([]);
    expect(
      indexAuditFindings([issueRow()], [newer, old], new Set([PAGE]), {})
        .triage,
    ).toBeNull();
    expect(
      indexAuditFindings([issueRow()], [newer, old], new Set([PAGE]), {
        from: "2026-11-16",
        to: "2026-11-16",
      }).findings,
    ).toHaveLength(1);
    expect(
      indexAuditFindings([issueRow()], [old], new Set([PAGE]), {
        from: "2026-11-17",
        to: "2026-11-17",
      }).findings,
    ).toEqual([]);
  });
});
