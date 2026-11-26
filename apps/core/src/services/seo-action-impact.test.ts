import { beforeEach, describe, expect, it, vi } from "vitest";

import { GSC_STATS_TOOL } from "@/lib/seo/native-statistics";
import type { ProjectSeoWorkspace } from "@/schemas/project-seo.schema";
import {
  AUDIT_PAGE_SERIES_KIND,
  type AuditPageSeries,
} from "@/schemas/seo-action-impact.schema";
import { AUDIT_PERFORMANCE_KIND } from "@/schemas/seo-audit-performance.schema";
import { expectCoreLog } from "@/test/core-log";
import { withSeoActionImpact } from "./project-seo-action-impact";
import { collectSeoAuditPageSeries } from "./seo-audit-page-series";
import { connectionVersion } from "./seo-connections.service";

const boundary = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  integration: vi.fn(),
  read: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectSeoObservation: {
      findFirst: boundary.findFirst,
      findMany: boundary.findMany,
    },
  },
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: (run: (tx: unknown) => unknown) =>
    run({ projectSeoObservation: { upsert: boundary.upsert } }),
}));
vi.mock("./seo-connections.service", async (original) => ({
  ...(await original<typeof import("./seo-connections.service")>()),
  resolveSeoStatisticsIntegration: boundary.integration,
}));
vi.mock("./project-seo-statistics.service", () => ({
  readNativeSeoTool: boundary.read,
}));

const actor = {
  userId: "owner",
  workspaceId: "workspace",
  organizationId: null,
  owner: { kind: "audit" as const, id: "audit" },
};
const pageA = "https://example.test/a";
const pageB = "https://example.test/b";
const account = {
  composioAccountId: "account",
  entityId: "entity",
  connectionRevision: "native:connection:1",
};

function days(from: string, to: string, clicks: number, impressions: number) {
  const rows = [];
  for (
    let at = Date.parse(`${from}T00:00:00Z`);
    at <= Date.parse(`${to}T00:00:00Z`);
    at += 86_400_000
  )
    rows.push({
      date: new Date(at).toISOString().slice(0, 10),
      clicks,
      impressions,
      position: 5,
    });
  return rows;
}

beforeEach(() => vi.resetAllMocks());

describe("withSeoActionImpact", () => {
  const action = (pageUrl: string) =>
    ({
      id: `fix:${pageUrl}`,
      pageUrl,
      completedAt: "2026-06-10T12:00:00.000Z",
    }) as ProjectSeoWorkspace["actions"][number];
  const series: AuditPageSeries = {
    propertyId: "sc-domain:example.test",
    from: "2026-04-20",
    to: "2026-07-18",
    pages: [
      {
        pageUrl: pageA,
        measuredUrl: pageA,
        days: days("2026-04-20", "2026-07-18", 2, 40),
      },
      {
        pageUrl: pageB,
        measuredUrl: pageB,
        days: days("2026-04-20", "2026-07-18", 100, 900),
      },
    ],
  };

  it("counts the rows of the action's page alone and leaves an unread page without impact", async () => {
    boundary.findMany.mockResolvedValue([{ payload: series }]);
    const [a, other] = await withSeoActionImpact(
      actor,
      [action(pageA), action("https://example.test/c")],
      new Date("2026-08-01T00:00:00Z"),
    );
    expect(a.impact).toMatchObject({
      state: "measured",
      before: { clicks: 56, impressions: 1120 },
      after: { clicks: 56, impressions: 1120 },
    });
    expect(other.impact).toBeUndefined();
    expect(boundary.findMany.mock.calls[0][0].where).toMatchObject({
      kind: AUDIT_PAGE_SERIES_KIND,
      ownerId: "owner",
      visibility: "PRIVATE",
    });
  });

  it("reports an unsettled after-window as too early", async () => {
    boundary.findMany.mockResolvedValue([{ payload: series }]);
    const [a] = await withSeoActionImpact(
      actor,
      [action(pageA)],
      new Date("2026-07-09T12:00:00Z"),
    );
    expect(a.impact).toMatchObject({ state: "too_early", after: null });
  });

  it("does not read the store when no action is done", async () => {
    const open = [{ ...action(pageA), completedAt: undefined }];
    expect(await withSeoActionImpact(actor, open)).toBe(open);
    expect(boundary.findMany).not.toHaveBeenCalled();
  });
});

describe("collectSeoAuditPageSeries", () => {
  const binding = {
    actor,
    access: {
      propertyId: "sc-domain:example.test",
      connectionVersion: connectionVersion(account),
    },
    period: { from: "2026-06-01", to: "2026-06-03" },
  };
  const authorize = vi.fn(async () => {});
  const measured = (stored: unknown = null) =>
    boundary.findFirst.mockImplementation(async ({ where }) =>
      where.kind === AUDIT_PERFORMANCE_KIND
        ? {
            pageIds: ["a", "b"],
            payload: {
              provider: "search_console",
              propertyId: binding.access.propertyId,
              pageUrls: [pageA, pageB],
              channel: "organic",
              from: binding.period.from,
              to: binding.period.to,
              timeZone: "America/Los_Angeles",
              observedAt: "2026-06-06T00:00:00.000Z",
              coverage: "partial",
              notes: [],
              metrics: [],
              auditMeasuredPages: [pageA, pageB].map((pageUrl) => ({
                pageUrl,
                measuredUrl: pageUrl,
                basis: "selected",
              })),
            },
          }
        : stored,
    );

  it("reads each page with an exact filter and leaves a failed page out of the stored row", async () => {
    expectCoreLog(
      "warn",
      "Could not read every audit page's daily Search Console rows",
    );
    measured();
    boundary.integration.mockResolvedValue(account);
    boundary.read.mockImplementation(async (_account, _slug, logical) => {
      if (JSON.stringify(logical).includes(pageB))
        throw new Error("quota exceeded");
      return {
        rows: [
          {
            keys: ["2026-06-01"],
            clicks: 3,
            impressions: 40,
            ctr: 0.075,
            position: 4,
          },
          {
            keys: ["2026-06-03"],
            clicks: 0,
            impressions: 0,
            ctr: 0,
            position: 0,
          },
        ],
      };
    });

    await collectSeoAuditPageSeries("task", binding, authorize);

    expect(boundary.read).toHaveBeenCalledTimes(2);
    for (const [, slug, logical] of boundary.read.mock.calls) {
      expect(slug).toBe(GSC_STATS_TOOL);
      expect(logical.dimension_filter_groups[0].filters).toEqual([
        {
          dimension: "page",
          operator: "equals",
          expression: expect.stringMatching(/^https:\/\/example\.test\/[ab]$/),
        },
      ]);
    }
    expect(authorize).toHaveBeenCalledTimes(1);
    const { create } = boundary.upsert.mock.calls[0][0];
    expect(create).toMatchObject({
      kind: AUDIT_PAGE_SERIES_KIND,
      sourceKey: "audit-page-series:task",
      ownerId: "owner",
      visibility: "PRIVATE",
      auditId: "audit",
    });
    expect(create.payload.pages).toEqual([
      {
        pageUrl: pageA,
        measuredUrl: pageA,
        days: [
          { date: "2026-06-01", clicks: 3, impressions: 40, position: 4 },
          { date: "2026-06-03", clicks: 0, impressions: 0, position: null },
        ],
      },
    ]);
  });

  it("reads nothing when the row has every page or the connection changed", async () => {
    measured({
      payload: {
        propertyId: binding.access.propertyId,
        ...binding.period,
        pages: [pageA, pageB].map((pageUrl) => ({
          pageUrl,
          measuredUrl: pageUrl,
          days: [],
        })),
      },
    });
    await collectSeoAuditPageSeries("task", binding, authorize);
    expect(boundary.integration).not.toHaveBeenCalled();

    measured();
    boundary.integration.mockResolvedValue({ ...account, entityId: "other" });
    await collectSeoAuditPageSeries("task", binding, authorize);
    expect(boundary.read).not.toHaveBeenCalled();
    expect(boundary.upsert).not.toHaveBeenCalled();
  });
});
