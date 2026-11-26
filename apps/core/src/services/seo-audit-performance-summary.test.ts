import { beforeEach, expect, it, vi } from "vitest";

import type { SeoActor } from "@/schemas/project-seo.schema";
import { AUDIT_PERFORMANCE_KIND } from "@/schemas/seo-audit-performance.schema";
import { readAuditPerformanceSummaries } from "./seo-audit-performance-summary";

const db = vi.hoisted(() => ({ observations: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  default: { projectSeoObservation: { findMany: db.observations } },
}));
vi.mock("./seo-audit-public-sitemaps", () => ({
  readPublicAuditSitemaps: vi.fn(async () => new Map()),
}));

const colleague = {
  userId: "colleague",
  workspaceId: "work",
  organizationId: null,
  owner: { kind: "audit", id: "audit" },
} as SeoActor;
const snapshot = {
  sourceTaskId: "public-audit",
  payload: {
    provider: "search_console",
    propertyId: "sc-domain:example.test",
    pageUrls: ["https://example.test/a"],
    channel: "organic",
    from: "2026-06-01",
    to: "2026-06-28",
    timeZone: "America/Los_Angeles",
    observedAt: "2026-07-01T00:00:00.000Z",
    coverage: "partial",
    notes: [],
    metrics: [
      { key: "clicks", label: "Clicks", unit: "count", value: 12, points: [] },
    ],
    auditMeasuredPages: [
      {
        pageUrl: "https://example.test/a",
        measuredUrl: "https://example.test/a",
        basis: "selected",
      },
    ],
  },
};

beforeEach(() => db.observations.mockReset());

it("gives a colleague the snapshot of an audit Task they may see, and no retry on it", async () => {
  db.observations.mockResolvedValue([snapshot]);
  const summary = await readAuditPerformanceSummaries(colleague, [
    "public-audit",
  ]);
  expect(summary.auditSearchConsole).toMatchObject([
    { taskId: "public-audit", clicks: 12 },
  ]);
  expect(summary.auditSearchConsoleRetryTaskIds).toEqual([]);
  // The Task list is the whole access rule: no requester filter narrows it further.
  expect(db.observations.mock.calls[0][0].where).toEqual({
    auditId: "audit",
    projectId: null,
    kind: AUDIT_PERFORMANCE_KIND,
    source: "search_console",
    sourceTaskId: { in: ["public-audit"] },
  });
});

it("reads nothing when the reader may see no audit Task", async () => {
  expect(await readAuditPerformanceSummaries(colleague, [])).toEqual({
    auditSearchConsole: [],
    auditSearchConsoleRetryTaskIds: [],
  });
  expect(db.observations).not.toHaveBeenCalled();
});
