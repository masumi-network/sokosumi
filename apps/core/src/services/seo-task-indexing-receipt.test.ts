import { describe, expect, it } from "vitest";

import { unavailableGscTaskInspection } from "@/lib/seo/native-gsc-task-inspection";
import {
  seoTaskIndexingReceiptSchema,
  seoTaskIndexingResultSchema,
} from "@/schemas/seo-task-indexing.schema";
import { sha256 } from "./project-seo-store";
import { hasSavedSeoIndexingAssessment } from "./seo-task-indexing-receipt";

const PAGE = "https://example.test/a";
const RECEIPT = seoTaskIndexingReceiptSchema.parse({
  version: 1,
  taskId: "task_1",
  receiptHash: "a".repeat(64),
  checkedAt: "2026-11-16T10:00:00.000Z",
  auditPageUrl: PAGE,
  status: "unavailable",
  pages: [unavailableGscTaskInspection(PAGE)],
});
function saved() {
  const payload = seoTaskIndexingResultSchema.parse({
    version: 1,
    taskId: RECEIPT.taskId,
    receiptHash: RECEIPT.receiptHash,
    checkedAt: RECEIPT.checkedAt,
    auditPageUrl: PAGE,
    assessments: [
      {
        pageUrl: PAGE,
        status: "unavailable",
        report: false,
        reason: "Google inspection is unavailable",
        suggestedFix: null,
        evidence: [],
      },
    ],
  });
  return {
    ownerId: "owner",
    visibility: "PRIVATE" as const,
    kind: "index_triage",
    source: "seo_worker",
    sourceTaskId: RECEIPT.taskId,
    artifactHash: sha256(JSON.stringify(payload)),
    payload,
  };
}

describe("saved indexing assessment delivery acknowledgement", () => {
  it("acknowledges a valid private assessment after its result response is lost", () => {
    expect(hasSavedSeoIndexingAssessment(saved(), RECEIPT, "owner", PAGE)).toBe(
      true,
    );
  });

  it("acknowledges a legacy receipt using the authorized original audit page", () => {
    const { auditPageUrl: _anchor, ...legacyReceipt } = RECEIPT;
    expect(
      hasSavedSeoIndexingAssessment(saved(), legacyReceipt, "owner", PAGE),
    ).toBe(true);
  });

  it.each([
    { ownerId: "another-owner" },
    { visibility: "PUBLIC" as const },
    { sourceTaskId: "another-task" },
    { kind: "index_inspection" },
    { source: "search_console" },
    { artifactHash: "b".repeat(64) },
  ])("rejects a foreign or invalid stored observation: %j", (changed) => {
    expect(
      hasSavedSeoIndexingAssessment(
        { ...saved(), ...changed },
        RECEIPT,
        "owner",
        PAGE,
      ),
    ).toBe(false);
  });

  it.each([
    { receiptHash: "b".repeat(64) },
    { checkedAt: "2026-11-15T10:00:00.000Z" },
    { auditPageUrl: "https://example.test/other" },
    {
      assessments: [
        {
          ...saved().payload.assessments[0],
          pageUrl: "https://example.test/other",
        },
      ],
    },
    { assessments: [{ ...saved().payload.assessments[0], status: "review" }] },
    {
      assessments: [
        ...saved().payload.assessments,
        ...saved().payload.assessments,
      ],
    },
  ])(
    "rejects an old receipt, changed scope, or unsupported assessment: %j",
    (changed) => {
      const observation = saved();
      const payload = { ...observation.payload, ...changed };
      expect(
        hasSavedSeoIndexingAssessment(
          {
            ...observation,
            payload,
            artifactHash: sha256(JSON.stringify(payload)),
          },
          RECEIPT,
          "owner",
          PAGE,
        ),
      ).toBe(false);
    },
  );
});
