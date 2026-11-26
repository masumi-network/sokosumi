import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { SeoActor } from "@/schemas/project-seo.schema";
import { AUDIT_PAGE_SERIES_KIND } from "@/schemas/seo-action-impact.schema";
import { AUDIT_PERFORMANCE_KIND } from "@/schemas/seo-audit-performance.schema";
import { readAuditPerformanceSummaries } from "./seo-audit-performance-summary";

const db = vi.hoisted(() => ({
  observations: vi.fn(),
  analyses: vi.fn(),
  integration: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectSeoObservation: { findMany: db.observations },
    projectSeoAnalysis: { findMany: db.analyses },
  },
}));
vi.mock("./seo-connections.service", () => ({
  resolveSeoStatisticsIntegration: db.integration,
  connectionVersion: (account: { connectionRevision: string }) =>
    account.connectionRevision,
}));
vi.mock("./seo-audit-public-sitemaps", () => ({
  readPublicAuditSitemaps: vi.fn(async () => new Map()),
}));

const approved = "a".repeat(64);
const colleague = {
  userId: "colleague",
  workspaceId: "work",
  organizationId: null,
  owner: { kind: "audit", id: "audit" },
} as SeoActor;
const snapshot = {
  sourceTaskId: "public-audit",
  ownerId: "requester",
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
    auditPropertyTotals: {
      clicks: 900,
      impressions: 9000,
      ctr: 0.1,
      averagePosition: 7,
    },
    auditMeasuredPages: [
      {
        pageUrl: "https://example.test/a",
        measuredUrl: "https://example.test/a",
        basis: "selected",
      },
    ],
  },
};

// A hook that returns a function gets it called as a cleanup, so neither returns the mock.
beforeEach(() => {
  db.observations.mockReset();
  db.integration.mockResolvedValue({ connectionRevision: approved });
  db.analyses.mockResolvedValue([
    {
      taskId: "public-audit",
      request: {
        searchConsoleAccess: {
          propertyId: "sc-domain:example.test",
          connectionVersion: approved,
        },
      },
    },
  ]);
});
afterEach(() => {
  vi.useRealTimers();
});

it("gives a colleague the snapshot of an audit Task they may see, and no retry on it", async () => {
  db.observations.mockResolvedValue([snapshot]);
  const summary = await readAuditPerformanceSummaries(colleague, [
    "public-audit",
  ]);
  expect(summary.auditSearchConsole).toMatchObject([
    { taskId: "public-audit", clicks: 12 },
  ]);
  expect(summary.auditSearchConsoleRetryTaskIds).toEqual([]);
  // Property-wide totals go past the audit's pages. The requester agreed to them for their own report only.
  expect(summary.auditSearchConsole[0]).not.toHaveProperty("propertyTotals");
  expect(summary.auditSearchConsole[0]).not.toHaveProperty("requester");
  const own = await readAuditPerformanceSummaries(
    { ...colleague, userId: "requester" },
    ["public-audit"],
  );
  expect(own.auditSearchConsole).toMatchObject([
    { requester: true, propertyTotals: { clicks: 900 } },
  ]);
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

it("keeps the retry for the requester while a verified page has no daily rows", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-10T00:00:00Z"));
  const requester = { ...colleague, userId: "requester" };
  const complete = {
    ...snapshot,
    payload: { ...snapshot.payload, auditPerformanceComplete: true },
  };
  const read = (
    pages: string[],
    propertyId = snapshot.payload.propertyId,
    measuredUrl?: string,
  ) => {
    db.observations.mockReset();
    db.observations.mockImplementation(async ({ where }) =>
      where.kind === AUDIT_PAGE_SERIES_KIND
        ? [
            {
              sourceTaskId: "public-audit",
              payload: {
                propertyId,
                from: "2025-05-25",
                to: "2026-06-28",
                pages: pages.map((pageUrl) => ({
                  pageUrl,
                  measuredUrl: measuredUrl ?? pageUrl,
                  days: [],
                })),
              },
            },
          ]
        : [complete],
    );
    return readAuditPerformanceSummaries(
      requester,
      ["public-audit"],
      ["public-audit"],
    );
  };
  // The page's daily read failed: the report is complete, the impact is not.
  expect((await read([])).auditSearchConsoleRetryTaskIds).toEqual([
    "public-audit",
  ]);
  expect(
    // Rows of another property are not this audit's rows.
    (await read(["https://example.test/a"], "sc-domain:other.test"))
      .auditSearchConsoleRetryTaskIds,
  ).toEqual(["public-audit"]);
  expect(
    (await read(["https://example.test/a"])).auditSearchConsoleRetryTaskIds,
  ).toEqual([]);
  // The stored rows are of an address Google no longer names for the page.
  expect(
    (
      await read(
        ["https://example.test/a"],
        undefined,
        "https://www.example.test/a",
      )
    ).auditSearchConsoleRetryTaskIds,
  ).toEqual(["public-audit"]);
  expect(db.observations.mock.calls[1][0].where).toMatchObject({
    kind: AUDIT_PAGE_SERIES_KIND,
    ownerId: "requester",
  });
  // After a switch to another account, a retry could not read Google.
  db.integration.mockResolvedValueOnce({ connectionRevision: "b".repeat(64) });
  expect((await read([])).auditSearchConsoleRetryTaskIds).toEqual([]);
  db.integration.mockResolvedValueOnce(null);
  expect((await read([])).auditSearchConsoleRetryTaskIds).toEqual([]);
  // Google no longer keeps the period: a retry could not read it.
  vi.setSystemTime(new Date("2027-12-01T00:00:00Z"));
  expect((await read([])).auditSearchConsoleRetryTaskIds).toEqual([]);
});
