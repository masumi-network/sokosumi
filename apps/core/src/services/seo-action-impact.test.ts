import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GSC_STATS_TOOL } from "@/lib/seo/native-statistics";
import type { ProjectSeoWorkspace } from "@/schemas/project-seo.schema";
import {
  AUDIT_PAGE_SERIES_KIND,
  type AuditPageSeries,
} from "@/schemas/seo-action-impact.schema";
import { AUDIT_PERFORMANCE_KIND } from "@/schemas/seo-audit-performance.schema";
import { expectCoreLog } from "@/test/core-log";
import { withSeoActionImpact } from "./project-seo-action-impact";
import { seoLinkedTaskWhere } from "./project-seo-store";
import { collectSeoAuditPageSeries } from "./seo-audit-page-series";
import { connectionVersion } from "./seo-connections.service";

const boundary = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  pages: vi.fn(),
  latest: vi.fn(),
  tasks: vi.fn(),
  owned: vi.fn(),
  integration: vi.fn(),
  read: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectSeoObservation: {
      findFirst: boundary.findFirst,
      findMany: boundary.findMany,
    },
    projectSeoPage: { findMany: boundary.pages },
    task: { findMany: boundary.tasks },
  },
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: (run: (tx: unknown) => unknown) =>
    run({
      projectSeoObservation: {
        upsert: boundary.upsert,
        // The audit's own snapshot is the same row inside the write as before it.
        findFirst: (query: { where: { kind: string } }) =>
          query.where.kind === AUDIT_PERFORMANCE_KIND
            ? boundary.findFirst(query)
            : boundary.latest(query),
      },
      projectSeoPage: { findMany: boundary.owned },
    }),
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

beforeEach(() => {
  vi.resetAllMocks();
  boundary.pages.mockResolvedValue([{ id: "page-a" }]);
  // Every audit Task is visible unless a test says otherwise.
  boundary.tasks.mockImplementation(async ({ where }) =>
    where.id.in.map((id: string) => ({ id })),
  );
  boundary.owned.mockResolvedValue([
    { id: "a", url: pageA },
    { id: "b", url: pageB },
  ]);
});
afterEach(() => vi.useRealTimers());

describe("withSeoActionImpact", () => {
  /** The stored audits, newest first. The first read lists them, the second takes the chosen payloads. */
  const store = (
    ...audits: { payload: unknown; pageIds?: string[]; sourceTaskId?: string }[]
  ) =>
    boundary.findMany.mockImplementation(async ({ where, select }) => {
      const rows = audits.map((audit, index) => ({
        id: `audit-${index}`,
        pageIds: ["page-a"],
        sourceTaskId: "audit-task",
        ...audit,
      }));
      return select.pageIds
        ? rows
        : rows.filter((row) => where.id.in.includes(row.id));
    });
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
    store({ payload: series });
    const [a, other] = await withSeoActionImpact(
      actor,
      [action(pageA), action("https://example.test/c")],
      undefined,
      new Date("2026-08-01T00:00:00Z"),
    );
    expect(a.impact).toMatchObject({
      state: "measured",
      before: { clicks: 56, impressions: 1120 },
      after: { clicks: 56, impressions: 1120 },
    });
    expect(other.impact).toBeUndefined();
    expect(boundary.findMany.mock.calls[0][0].where).toEqual({
      auditId: "audit",
      projectId: null,
      kind: AUDIT_PAGE_SERIES_KIND,
      sourceTaskId: { not: null },
      pageIds: { hasSome: ["page-a"] },
    });
    expect(boundary.pages.mock.calls[0][0].where).toEqual({
      auditId: "audit",
      projectId: null,
      url: { in: [pageA, "https://example.test/c"] },
    });
  });

  it("finds the rows of an action reported with a fragment on its page address", async () => {
    store({ payload: series });
    const [a] = await withSeoActionImpact(
      actor,
      [action(`${pageA}#title`)],
      undefined,
      new Date("2026-08-01T00:00:00Z"),
    );
    expect(a.impact).toMatchObject({ state: "measured" });
  });

  it("does not join the rows of two addresses Google measured for one page", async () => {
    // The newer audit measured the www address from 2026-06-01 only. The older one measured the bare address.
    const moved: AuditPageSeries = {
      ...series,
      from: "2026-06-01",
      pages: [
        {
          pageUrl: pageA,
          measuredUrl: "https://www.example.test/a",
          days: days("2026-06-01", "2026-07-18", 9, 90),
        },
      ],
    };
    store({ payload: moved }, { payload: series });
    const [a] = await withSeoActionImpact(
      actor,
      [action(pageA)],
      undefined,
      new Date("2026-08-01T00:00:00Z"),
    );
    // Joined, the before-window would count the bare address and the after-window the www address.
    expect(a.impact).toMatchObject({ state: "not_measured", before: null });
  });

  it("ranks the audits by when their Task began, so a late retry of an older audit does not win", async () => {
    // The older audit measured the www address from 2026-06-01. Its retry wrote last, so the store lists it first.
    const moved: AuditPageSeries = {
      ...series,
      from: "2026-06-01",
      pages: [
        {
          pageUrl: pageA,
          measuredUrl: "https://www.example.test/a",
          days: days("2026-06-01", "2026-07-18", 9, 90),
        },
      ],
    };
    store(
      { payload: moved, sourceTaskId: "older-audit" },
      { payload: series, sourceTaskId: "newer-audit" },
    );
    boundary.tasks.mockResolvedValue([
      { id: "newer-audit" },
      { id: "older-audit" },
    ]);
    const [a] = await withSeoActionImpact(
      actor,
      [action(pageA)],
      undefined,
      new Date("2026-08-01T00:00:00Z"),
    );
    expect(a.impact).toMatchObject({ state: "measured" });
    expect(boundary.tasks.mock.calls[0][0].orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("counts the limit of audits per page, so many audits of one page do not hide another page's only audit", async () => {
    boundary.pages.mockResolvedValue([{ id: "page-a" }, { id: "page-b" }]);
    const [onlyA, onlyB] = [0, 1].map((index) => ({
      ...series,
      pages: [series.pages[index]],
    }));
    store(...Array.from({ length: 7 }, () => ({ payload: onlyA })), {
      payload: onlyB,
      pageIds: ["page-b"],
    });
    const [a, b] = await withSeoActionImpact(
      actor,
      [action(pageA), action(pageB)],
      undefined,
      new Date("2026-08-01T00:00:00Z"),
    );
    expect(a.impact).toMatchObject({ state: "measured" });
    expect(b.impact).toMatchObject({
      state: "measured",
      before: { clicks: 2800 },
    });
    // Six of page A's seven audits and the one of page B.
    expect(boundary.findMany.mock.calls[1][0].where.id.in).toHaveLength(7);
  });

  it("counts a page's days by the range that page was read for", async () => {
    // The row's range starts on 2026-06-01. Page A was read earlier, from 2026-04-20.
    store({
      payload: {
        ...series,
        from: "2026-06-01",
        pages: [{ ...series.pages[0], from: "2026-04-20", to: "2026-07-18" }],
      },
    });
    const [a] = await withSeoActionImpact(
      actor,
      [action(pageA)],
      undefined,
      new Date("2026-08-01T00:00:00Z"),
    );
    expect(a.impact).toMatchObject({ state: "measured" });
  });

  it("narrows the rows to one person's own when the caller names that person", async () => {
    boundary.findMany.mockResolvedValue([]);
    await withSeoActionImpact(actor, [action(pageA)], {
      ownerId: "ada",
    });
    expect(boundary.findMany.mock.calls[0][0].where.ownerId).toBe("ada");
  });

  it("reads the rows by the audit Tasks the reader may see, not by who requested the audit", async () => {
    // The newer audit's Task is private to a colleague. The older audit's Task is public.
    store(
      { payload: series, sourceTaskId: "private-audit" },
      { payload: series, sourceTaskId: "public-audit" },
    );
    boundary.tasks.mockResolvedValue([{ id: "public-audit" }]);
    const reader = { ...actor, userId: "colleague" };
    const [a] = await withSeoActionImpact(
      reader,
      [action(pageA)],
      undefined,
      new Date("2026-08-01T00:00:00Z"),
    );
    expect(a.impact).toMatchObject({ state: "measured" });
    expect(boundary.findMany.mock.calls[0][0].where).not.toHaveProperty(
      "ownerId",
    );
    expect(boundary.tasks.mock.calls[0][0].where).toEqual({
      id: { in: ["private-audit", "public-audit"] },
      ...seoLinkedTaskWhere(reader, true),
    });
    expect(boundary.findMany.mock.calls[1][0].where.id.in).toEqual(["audit-1"]);
  });

  it("reports an unsettled after-window as too early", async () => {
    store({ payload: series });
    const [a] = await withSeoActionImpact(
      actor,
      [action(pageA)],
      undefined,
      new Date("2026-07-09T12:00:00Z"),
    );
    expect(a.impact).toMatchObject({ state: "too_early", after: null });
    // The caller's shorter window is settled on the same day.
    const [week] = await withSeoActionImpact(
      actor,
      [action(pageA)],
      { days: 7 },
      new Date("2026-07-09T12:00:00Z"),
    );
    expect(week.impact).toMatchObject({
      days: 7,
      state: "measured",
      after: { clicks: 14 },
    });
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
  const measured = (
    stored: unknown = null,
    basis: [string, string] = ["selected", "selected"],
    addresses: [string, string] = [pageA, pageB],
  ) =>
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
              auditMeasuredPages: [pageA, pageB].map((pageUrl, index) => ({
                pageUrl,
                measuredUrl: addresses[index],
                basis: basis[index],
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
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-06T00:00:00Z"));
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
      expect(logical).toMatchObject({
        start_date: "2025-04-30",
        end_date: "2026-06-03",
      });
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
    // The stored row names the 400 days the reads asked for, not the audit's own period.
    expect(create.payload).toMatchObject({
      from: "2025-04-30",
      to: "2026-06-03",
    });
    // Page B's read failed, so the row is not a row of page B.
    expect(create.pageIds).toEqual(["a"]);
    expect(create.payload.pages).toEqual([
      {
        pageUrl: pageA,
        measuredUrl: pageA,
        from: "2025-04-30",
        to: "2026-06-03",
        days: [
          { date: "2026-06-01", clicks: 3, impressions: 40, position: 4 },
          { date: "2026-06-03", clicks: 0, impressions: 0, position: null },
        ],
      },
    ]);
  });

  it("keeps a page another collection stored meanwhile and asks for no day Google no longer keeps", async () => {
    expectCoreLog(
      "warn",
      "Could not read every audit page's daily Search Console rows",
    );
    // A retry 176 days after the period: 400 days back is past Google's 480 days.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-26T00:00:00Z"));
    measured();
    boundary.integration.mockResolvedValue(account);
    boundary.read.mockImplementation(async (_account, _slug, logical) => {
      if (JSON.stringify(logical).includes(pageB)) throw new Error("quota");
      return { rows: [] };
    });
    const other = { pageUrl: pageB, measuredUrl: pageB, days: [] };
    boundary.latest.mockResolvedValue({
      payload: {
        propertyId: binding.access.propertyId,
        from: "2025-08-04",
        to: "2026-06-03",
        pages: [other],
      },
    });

    await collectSeoAuditPageSeries("task", binding, authorize);

    expect(boundary.read.mock.calls[0][2]).toMatchObject({
      start_date: "2025-08-04",
    });
    const { payload, pageIds } = boundary.upsert.mock.calls[0][0].update;
    expect(payload.from).toBe("2025-08-04");
    const range = { from: "2025-08-04", to: "2026-06-03" };
    expect(payload.pages).toEqual([
      { ...range, ...other },
      { pageUrl: pageA, measuredUrl: pageA, ...range, days: [] },
    ]);
    expect(pageIds).toEqual(["a", "b"]);
  });

  it("keeps the longer range of a stored page when a late retry adds a page, and never reads an unverified address", async () => {
    // The first collection stored page A for 400 days. The retry 176 days later can ask Google for fewer.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-26T00:00:00Z"));
    const first = {
      payload: {
        propertyId: binding.access.propertyId,
        from: "2025-04-30",
        to: binding.period.to,
        pages: [
          {
            pageUrl: pageA,
            measuredUrl: pageA,
            days: days("2025-04-30", "2025-04-30", 1, 1),
          },
        ],
      },
    };
    measured(first);
    boundary.latest.mockResolvedValue(first);
    boundary.integration.mockResolvedValue(account);
    boundary.read.mockResolvedValue({ rows: [] });
    await collectSeoAuditPageSeries("task", binding, authorize);
    expect(boundary.read).toHaveBeenCalledTimes(1);
    expect(boundary.upsert.mock.calls[0][0].update.payload.pages).toEqual([
      { from: "2025-04-30", to: "2026-06-03", ...first.payload.pages[0] },
      {
        pageUrl: pageB,
        measuredUrl: pageB,
        from: "2025-08-04",
        to: "2026-06-03",
        days: [],
      },
    ]);

    // Page B's address is a guess. Only page A is read.
    vi.clearAllMocks();
    measured(null, ["selected", "unverified"]);
    boundary.latest.mockResolvedValue(null);
    await collectSeoAuditPageSeries("task", binding, authorize);
    expect(boundary.read).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(boundary.read.mock.calls[0][2])).toContain(pageA);
    expect(boundary.upsert.mock.calls[0][0].create.pageIds).toEqual(["a"]);

    vi.clearAllMocks();
    measured(null, ["unverified", "unverified"]);
    await collectSeoAuditPageSeries("task", binding, authorize);
    expect(boundary.integration).not.toHaveBeenCalled();
    expect(boundary.upsert).not.toHaveBeenCalled();
  });

  it("reads a page again under its new address, keeps a longer read stored meanwhile, and writes nothing when every read fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-26T00:00:00Z"));
    const row = (from: string, ...pages: [string, string][]) => ({
      payload: {
        propertyId: binding.access.propertyId,
        from,
        to: binding.period.to,
        pages: pages.map(([pageUrl, measuredUrl]) => ({
          pageUrl,
          measuredUrl,
          days: [],
        })),
      },
    });
    const www = "https://www.example.test/a";
    // Page A was read under the www address. Google now names the bare address.
    measured(row("2025-04-30", [pageA, www], [pageB, pageB]));
    boundary.integration.mockResolvedValue(account);
    boundary.read.mockResolvedValue({ rows: [] });
    // Another retry read the bare address for more days and stored it first.
    const longer = row("2025-06-01", [pageA, pageA], [pageB, pageB]);
    boundary.latest.mockResolvedValue(longer);
    await collectSeoAuditPageSeries("task", binding, authorize);
    expect(boundary.read).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(boundary.read.mock.calls[0][2])).toContain(
      '"expression":"https://example.test/a"',
    );
    // The stored read stays as it is: nothing is written.
    expect(boundary.upsert).not.toHaveBeenCalled();

    // Stored meanwhile under the old address only: the new read replaces it.
    vi.clearAllMocks();
    boundary.latest.mockResolvedValue(row("2025-04-30", [pageA, www]));
    await collectSeoAuditPageSeries("task", binding, authorize);
    expect(boundary.upsert.mock.calls[0][0].update.payload.pages).toEqual([
      {
        pageUrl: pageA,
        measuredUrl: pageA,
        from: "2025-08-04",
        to: binding.period.to,
        days: [],
      },
    ]);

    // Google named the www address again while this read ran. The read of the bare address is not stored.
    vi.clearAllMocks();
    boundary.latest.mockResolvedValue(null);
    boundary.read.mockImplementationOnce(async () => {
      measured(
        row("2025-04-30", [pageA, www], [pageB, pageB]),
        ["google_canonical", "selected"],
        [www, pageB],
      );
      return { rows: [] };
    });
    await collectSeoAuditPageSeries("task", binding, authorize);
    expect(boundary.read).toHaveBeenCalledTimes(1);
    expect(boundary.upsert).not.toHaveBeenCalled();

    expectCoreLog(
      "warn",
      "Could not read every audit page's daily Search Console rows",
    );
    vi.clearAllMocks();
    measured(row("2025-04-30", [pageA, www], [pageB, pageB]));
    boundary.read.mockRejectedValue(new Error("quota"));
    await collectSeoAuditPageSeries("task", binding, authorize);
    expect(boundary.upsert).not.toHaveBeenCalled();
  });

  it("reads nothing when the row has every page or the connection changed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-06T00:00:00Z"));
    measured({
      payload: {
        propertyId: binding.access.propertyId,
        from: "2025-04-30",
        to: binding.period.to,
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
