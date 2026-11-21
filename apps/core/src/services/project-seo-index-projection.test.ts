import { randomUUID } from "node:crypto";
import type { ProjectSeoObservation } from "@sokosumi/database";
import { describe, expect, it } from "vitest";
import {
  SEO_MAX_INDEX_ASSESSMENTS,
  seoIndexTriageSchema,
} from "@/schemas/project-seo.schema";
import {
  indexAuditFindings,
  newestIndexTriage,
  withIndexIssueCounts,
} from "./project-seo-index-projection";
import { resolveSeoIndexingAuditPageUrl } from "./seo-task-indexing-context";

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
  it("bounds a large selected collection before returning the workspace triage DTO", () => {
    const urls = Array.from(
      { length: SEO_MAX_INDEX_ASSESSMENTS + 1 },
      (_, index) => `https://example.com/page-${index}`,
    );
    const observations = urls.map((pageUrl) => {
      const observation = row();
      observation.payload = {
        ...(observation.payload as object),
        assessments: [
          {
            pageUrl,
            status: "review",
            report: false,
            reason: "Review intent",
            suggestedFix: null,
            evidence: [],
          },
        ],
      };
      return observation;
    });
    const result = newestIndexTriage(observations, new Set(urls));
    expect(result?.assessments).toHaveLength(SEO_MAX_INDEX_ASSESSMENTS);
    expect(seoIndexTriageSchema.safeParse(result).success).toBe(true);
  });
  it("attaches lightweight related issues to the audited page without adding that URL to its full-audit scope", () => {
    const audit = auditRow();
    const publicPayload = audit.payload as { pageUrls: string[] };
    publicPayload.pageUrls = [PAGE];
    const observation = issueRow();
    observation.payload = {
      ...(observation.payload as object),
      auditPageUrl: PAGE,
      assessments: [
        {
          pageUrl: PAGE,
          status: "indexed",
          report: false,
          reason: "Indexed",
          suggestedFix: null,
          evidence: [],
        },
        {
          pageUrl: OTHER,
          status: "issue",
          report: true,
          reason: "The related page should be reachable",
          suggestedFix: "Fix the broken internal link or its target",
          evidence: ["Related URL returned HTTP 404"],
          checkedAt: "2026-11-16T09:00:00.000Z",
        },
      ],
    };
    const before = JSON.stringify(audit.payload);
    const result = indexAuditFindings(
      [observation],
      [audit],
      new Set([PAGE]),
      {},
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      observationId: audit.id,
      pageUrl: PAGE,
      relatedPageUrl: OTHER,
      observedAt: "2026-11-16T09:00:00.000Z",
      visibility: "PRIVATE",
      suggestedFix: "Fix the broken internal link or its target",
    });
    expect(result.counts.get(audit.id)).toBe(1);
    expect(
      result.triage?.assessments.find(
        (assessment) => assessment.pageUrl === OTHER,
      ),
    ).toMatchObject({
      auditPageUrl: PAGE,
      taskId: "task_1",
      checkedAt: "2026-11-16T09:00:00.000Z",
    });
    expect(JSON.stringify(audit.payload)).toBe(before);
    expect(publicPayload.pageUrls).toEqual([PAGE]);
    expect(
      indexAuditFindings([observation], [audit], new Set([OTHER]), {}).findings,
    ).toEqual([]);
  });

  it("projects related evidence under the successful seed when the original primary audit was skipped", () => {
    const relatedPageUrl = "https://example.com/nearby";
    const audit = auditRow();
    (audit.payload as { pageUrls: string[] }).pageUrls = [OTHER];
    const privateAssessment = row();
    privateAssessment.payload = {
      ...(privateAssessment.payload as object),
      auditPageUrl: resolveSeoIndexingAuditPageUrl([PAGE, OTHER], OTHER),
      assessments: [
        {
          pageUrl: relatedPageUrl,
          status: "issue",
          report: true,
          reason: "A linked page is missing from search",
          suggestedFix: "Restore the relevant internal link",
          evidence: [],
        },
      ],
    };
    const result = indexAuditFindings(
      [privateAssessment],
      [audit],
      new Set([PAGE, OTHER]),
      {},
    );
    expect(result.findings).toEqual([
      expect.objectContaining({
        observationId: audit.id,
        pageUrl: OTHER,
        relatedPageUrl,
      }),
    ]);
    expect(result.triage?.assessments).toEqual([
      expect.objectContaining({
        pageUrl: relatedPageUrl,
        auditPageUrl: OTHER,
      }),
    ]);
    expect((audit.payload as { pageUrls: string[] }).pageUrls).toEqual([OTHER]);
  });

  it("keeps expected exclusions and uncertain intent as related evidence without counting them as issues", () => {
    const audit = auditRow();
    (audit.payload as { pageUrls: string[] }).pageUrls = [PAGE];
    const observation = row();
    observation.payload = {
      ...(observation.payload as object),
      auditPageUrl: PAGE,
      assessments: [
        {
          pageUrl: OTHER,
          status: "expected_exclusion",
          report: false,
          reason: "The redirect is intended",
          suggestedFix: "Keep the redirect",
          evidence: [],
        },
        {
          pageUrl: "https://example.com/private",
          status: "review",
          report: false,
          reason: "Confirm noindex intent",
          suggestedFix: "Keep noindex if intended",
          evidence: [],
        },
      ],
    };
    const result = indexAuditFindings(
      [observation],
      [audit],
      new Set([PAGE]),
      {},
    );
    expect(result.findings).toEqual([]);
    expect(result.counts.size).toBe(0);
    expect(result.triage?.assessments).toMatchObject([
      { pageUrl: OTHER, auditPageUrl: PAGE, status: "expected_exclusion" },
      {
        pageUrl: "https://example.com/private",
        auditPageUrl: PAGE,
        status: "review",
      },
    ]);
  });

  it("keeps one related URL separate for two currently selected audited parents", () => {
    const related = "https://example.com/shared-target";
    const audits = [PAGE, OTHER].map((pageUrl, index) => {
      const audit = { ...auditRow(), sourceTaskId: `task_${index + 1}` };
      (audit.payload as { pageUrls: string[] }).pageUrls = [pageUrl];
      return audit;
    });
    const notes = [PAGE, OTHER].map((auditPageUrl, index) => ({
      ...row(),
      sourceTaskId: `task_${index + 1}`,
      payload: {
        version: 1,
        taskId: `task_${index + 1}`,
        receiptHash: "a".repeat(64),
        checkedAt: CHECKED_AT,
        auditPageUrl,
        assessments: [
          {
            pageUrl: related,
            status: "issue",
            report: true,
            reason: "Broken target",
            suggestedFix: "Fix the link target",
            evidence: [],
          },
        ],
      },
    }));
    const result = indexAuditFindings(
      notes,
      audits,
      new Set([PAGE, OTHER]),
      {},
    );
    expect(
      result.findings.map((finding) => [
        finding.pageUrl,
        finding.relatedPageUrl,
      ]),
    ).toEqual([
      [PAGE, related],
      [OTHER, related],
    ]);
    expect(
      result.triage?.assessments.map((assessment) => assessment.auditPageUrl),
    ).toEqual([PAGE, OTHER]);
    expect(result.counts.get(audits[0].id)).toBe(1);
    expect(result.counts.get(audits[1].id)).toBe(1);
  });

  it("requires a current matching public Task and an audited same-host parent before exposing related evidence", () => {
    const audit = auditRow();
    (audit.payload as { pageUrls: string[] }).pageUrls = [PAGE];
    const original = issueRow();
    const originalAssessments = (original.payload as { assessments: unknown[] })
      .assessments;
    const relatedIssue = {
      ...(originalAssessments[0] as object),
      pageUrl: OTHER,
    };
    for (const [auditPageUrl, pageUrl] of [
      ["https://example.com/unrelated", OTHER],
      [PAGE, "https://foreign.test/related"],
    ]) {
      const observation = {
        ...original,
        payload: {
          ...(original.payload as object),
          auditPageUrl,
          assessments: [{ ...relatedIssue, pageUrl }],
        },
      };
      const result = indexAuditFindings(
        [observation],
        [audit],
        new Set([PAGE]),
        {},
      );
      expect(result.findings).toEqual([]);
      expect(result.triage).toBeNull();
    }
    const observation = {
      ...original,
      payload: {
        ...(original.payload as object),
        auditPageUrl: PAGE,
        assessments: [relatedIssue],
      },
    };
    expect(newestIndexTriage([observation], new Set([PAGE]))).toBeNull();
    const newer = { ...auditRow(), sourceTaskId: "task_2" };
    (newer.payload as { pageUrls: string[] }).pageUrls = [PAGE];
    const result = indexAuditFindings(
      [observation],
      [newer, audit],
      new Set([PAGE]),
      {},
    );
    expect(result.findings).toEqual([]);
    expect(result.triage).toBeNull();
    expect(
      indexAuditFindings(
        [observation],
        [{ ...audit, sourceTaskId: "another_task" }],
        new Set([PAGE]),
        {},
      ).triage,
    ).toBeNull();
  });

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

  it.each([
    ["note", 1],
    ["major", 0],
  ] as const)(
    "counts a private index issue beside a public %s",
    (severity, expected) => {
      const audit = auditRow();
      audit.payload = {
        ...(audit.payload as object),
        findings: [
          {
            id: "index-check",
            rowId: "AC-20",
            pageUrl: PAGE,
            device: null,
            title: "Indexing",
            severity,
            evidence: [],
            sourceRef: "report",
            observedAt: CHECKED_AT,
          },
        ],
      };
      const result = indexAuditFindings(
        [issueRow()],
        [audit],
        new Set([PAGE]),
        {},
      );
      expect(result.findings).toHaveLength(expected);
      expect(result.counts.get(audit.id) ?? 0).toBe(expected);
    },
  );

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
