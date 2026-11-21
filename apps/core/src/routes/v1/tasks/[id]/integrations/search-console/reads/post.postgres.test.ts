/** Real Task authorization and PostgreSQL locking. Composio and Google are local fakes. */
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { getWebAppBaseUrl } from "@/config/env";
import prisma from "@/lib/db/prisma";
import type { AuthenticationContext } from "@/middleware/auth";
import { coreLogEvents, expectCoreLog } from "@/test/core-log";
import { inRequest } from "@/test/in-request";
import {
  day,
  searchConsoleReadsEnabled as enabled,
  INSPECT_TOOL,
  INSPECTION,
  LIST_TOOL,
  PAGE_URLS,
  PROPERTY,
  ROWS,
  STATS_TOOL,
  searchConsoleReadFixture,
} from "@/test-fixtures/seo-task-search-console-reads";
import { createTaskScheduleTestApp } from "@/test-fixtures/task-schedule-app";
import mountStatus from "../get";

const { network, ids } = vi.hoisted(() => ({
  network: {
    tools: vi.fn(),
    describe: vi.fn(),
    fetch: vi.fn(),
    account: vi.fn(),
  },
  ids: { executor: crypto.randomUUID() },
}));
vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: async (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock("@/clients/composio.client", () => ({
  getComposio: () => ({
    tools: {
      getRawComposioTools: network.tools,
      getRawComposioToolBySlug: network.describe,
    },
  }),
  getComposioConnectedAccount: network.account,
}));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      SEO_ANALYSIS_EXECUTOR: {
        mode: "global",
        coworkerId: ids.executor,
        canUsePaidSearchData: true,
        canSchedule: true,
      },
    }),
  };
});

describe.skipIf(!enabled)("Task-scoped Search Console reads", () => {
  const fx = searchConsoleReadFixture(network, ids.executor);
  const {
    ownerId,
    workspaceId,
    organizationId,
    vendorId,
    coworkerId,
    otherCoworkerId,
    auditId,
  } = fx;
  const { sitesList, query, inspect, read, status, setAccess, kindOf } = fx;

  it("returns Google's native bodies and lists only the approved property", async () => {
    const sites = await read(sitesList);
    expect(sites.status, await sites.clone().text()).toBe(200);
    expect(sites.headers.get("cache-control")).toBe("no-store");
    expect((await sites.json()).data).toEqual({
      status: 200,
      body: {
        siteEntry: [{ siteUrl: PROPERTY, permissionLevel: "siteOwner" }],
      },
    });
    const rows = await read(
      query({
        type: "web",
        dataState: "final",
        dimensionFilterGroups: [
          {
            groupType: "and",
            filters: [
              {
                dimension: "page",
                operator: "equals",
                expression: PAGE_URLS[0],
              },
            ],
          },
        ],
      }),
    );
    expect(rows.status, await rows.clone().text()).toBe(200);
    expect((await rows.json()).data).toEqual({ status: 200, body: ROWS });
    const inspected = await read(inspect());
    expect((await inspected.json()).data).toEqual({
      status: 200,
      body: INSPECTION,
    });
    expect(fx.reads.map((entry) => entry.slug)).toEqual([
      LIST_TOOL,
      STATS_TOOL,
      INSPECT_TOOL,
    ]);
    for (const entry of fx.reads)
      expect(entry.input.connected_account_id).toBe(fx.composioAccountId);
    expect(fx.reads[1]!.input.arguments).toMatchObject({
      site_url: PROPERTY,
      row_limit: 25_000,
      start_row: 0,
      search_type: "web",
      data_state: "final",
    });
    expect(fx.reads[2]!.input.arguments).toEqual({
      site_url: PROPERTY,
      inspection_url: PAGE_URLS[0],
    });
  });

  it("refuses a stale owner or organization before any provider read", async () => {
    for (const body of [
      { ...sitesList, expectedOwnerId: randomUUID() },
      { ...query(), expectedOrganizationId: null },
    ]) {
      const response = await read(body);
      expect(response.status).toBe(409);
      expect(await kindOf(response)).toBe("task_context_changed");
    }
    expect(fx.reads).toEqual([]);
  });

  it("requires the configured SEO worker's bare key on its own assigned Task", async () => {
    const callers: AuthenticationContext[] = [
      { actor: "user", userId: ownerId, organizationId, role: "user" },
      {
        actor: "coworker",
        coworkerId,
        vendorId,
        context: { userId: ownerId, organizationId },
      },
      { actor: "coworker", coworkerId: otherCoworkerId, vendorId },
    ];
    for (const caller of callers) {
      fx.actor = caller;
      expect((await read(sitesList)).status).toBe(403);
    }
    expect(
      (
        await createTaskScheduleTestApp(mountStatus, fx.actor, null).request(
          `http://localhost/${fx.taskId}/integrations/search-console`,
        )
      ).status,
    ).toBe(403);
    fx.actor = { actor: "coworker", coworkerId, vendorId };
    await prisma.task.update({
      where: { id: fx.taskId },
      data: { assigneeId: otherCoworkerId },
    });
    expect((await read(sitesList)).status).toBe(403);
    await prisma.task.update({
      where: { id: fx.taskId },
      data: { assigneeId: coworkerId },
    });
    await prisma.vendorGrant.create({
      data: {
        vendorId,
        workspaceId,
        status: "DENIED",
        permission: "workspace",
      },
    });
    expect((await read(sitesList)).status).toBe(403);
    expect(fx.reads).toEqual([]);
  });

  it("refuses another property or a URL outside the property before any provider read", async () => {
    for (const body of [
      { ...query(), siteUrl: "https://other-client.test/" },
      { ...inspect(), siteUrl: "sc-domain:private.test" },
      inspect("https://foreign.test/page"),
    ]) {
      const response = await read(body);
      expect(response.status).toBe(409);
      expect(await kindOf(response)).toBe("seo_gsc_property");
    }
    expect(fx.reads).toEqual([]);
  });

  it("refuses out-of-range queries instead of clamping them", async () => {
    for (const extra of [
      { rowLimit: 25_001 },
      { rowLimit: 0 },
      { startRow: 975_001 },
      { startDate: day(-3), endDate: day(-30) },
      { startDate: day(-501) },
      { dimensions: ["hour"] },
      {
        dimensionFilterGroups: [
          { filters: [{ dimension: "page", expression: "x".repeat(4097) }] },
        ],
      },
    ])
      expect((await read(query(extra))).status, JSON.stringify(extra)).toBe(
        422,
      );
    expect((await read({ ...sitesList, propertyId: PROPERTY })).status).toBe(
      422,
    );
    expect(fx.reads).toEqual([]);
  });

  it("reads only while the Task runs, and reports status after completion", async () => {
    for (const taskStatus of ["READY", "COMPLETED"] as const) {
      await prisma.task.update({
        where: { id: fx.taskId },
        data: { status: taskStatus },
      });
      expect((await read(sitesList)).status).toBe(409);
    }
    expect(fx.reads).toEqual([]);
    expect(await status()).toEqual({
      provider: "search-console",
      status: "CONNECTED",
      authenticationUrl: `${getWebAppBaseUrl().replace(/\/+$/, "")}/tasks/${fx.taskId}?googleConnection=connect`,
      expiresAt: null,
    });
  });

  it("names the state of a limited, legacy, replaced or pending connection", async () => {
    await setAccess(null);
    expect(await status()).toMatchObject({
      status: "NOT_CONNECTED",
      reason: "limited_audit",
    });
    const limited = await read(sitesList);
    expect(limited.status).toBe(409);
    expect(await kindOf(limited)).toBe("seo_gsc_not_connected");
    await setAccess(undefined);
    expect(await status()).toMatchObject({
      status: "NOT_CONNECTED",
      reason: "not_connected",
    });
    await setAccess({
      propertyId: PROPERTY,
      connectionVersion: "0".repeat(64),
    });
    expect(await status()).toMatchObject({
      status: "NOT_CONNECTED",
      reason: "reconnect",
      expiresAt: null,
    });
    const replaced = await read(query());
    expect(replaced.status).toBe(409);
    expect(await kindOf(replaced)).toBe("seo_gsc_reconnect");
    const expiresAt = new Date(Date.now() + 600_000);
    await prisma.seoConnectionIntent.create({
      data: {
        connectionId: randomUUID(),
        workspaceId,
        userId: ownerId,
        provider: "search_console",
        toolkit: "google_search_console",
        authConfigId: "fixture-auth-config",
        connectorEntityId: "fixture-owner-search-console",
        executorEntityId: "fixture-owner-search-console",
        expectedRevision: 1,
        expiresAt,
      },
    });
    expect(await status()).toEqual(
      expect.objectContaining({
        status: "PENDING",
        reason: "reconnect",
        expiresAt: expiresAt.toISOString(),
      }),
    );
    expect(fx.reads).toEqual([]);
  });

  it("returns no Google body when the Task or connection changes during the provider call", async () => {
    fx.providerHook = async () => {
      await prisma.task.update({
        where: { id: fx.taskId },
        data: { assigneeId: otherCoworkerId },
      });
      return null;
    };
    const reassigned = await read(query());
    expect(reassigned.status).toBe(403);
    expect(await reassigned.text()).not.toContain("widget");
    await prisma.task.update({
      where: { id: fx.taskId },
      data: { assigneeId: coworkerId },
    });
    fx.providerHook = async () => {
      await prisma.seoConnection.update({
        where: { id: fx.connectionId },
        data: { revision: { increment: 1 } },
      });
      return null;
    };
    const replaced = await read(query());
    expect(replaced.status).toBe(409);
    expect(await kindOf(replaced)).toBe("seo_gsc_reconnect");
    expect(fx.reads).toHaveLength(2);
  });

  it("maps provider failures to retryable 503 and a revoked account to reconnect", async () => {
    expectCoreLog("warn", "A Task-scoped Search Console read failed", 3);
    await prisma.seoConnection.update({
      where: { id: fx.connectionId },
      data: { authConfigId: "fixture-auth-config" },
    });
    fx.providerHook = () => new Response("upstream failed", { status: 500 });
    expect((await read(query())).status).toBe(503);
    fx.providerHook = () => {
      throw new DOMException("The operation timed out", "TimeoutError");
    };
    expect((await read(inspect())).status).toBe(503);
    fx.providerHook = () =>
      Response.json({ successful: false, error: "invalid_grant" });
    network.account.mockResolvedValue({
      id: fx.composioAccountId,
      status: "EXPIRED",
      toolkitSlug: "google_search_console",
      authConfigId: "fixture-auth-config",
      connectorUserId: "fixture-owner-search-console",
    });
    const revoked = await read(query());
    expect(revoked.status).toBe(409);
    expect(await kindOf(revoked)).toBe("seo_gsc_reconnect");
    expect(
      (
        await prisma.seoConnection.findUniqueOrThrow({
          where: { id: fx.connectionId },
        })
      ).status,
    ).toBe("NEEDS_RECONNECT");
  });

  it("refuses an oversized reply and a reply that holds a credential field", async () => {
    fx.providerHook = () =>
      Response.json({
        successful: true,
        data: {
          rows: [{ ...ROWS.rows[0], keys: ["x".repeat(2 * 1024 * 1024)] }],
        },
      });
    const large = await read(query());
    expect(large.status).toBe(502);
    expect(await kindOf(large)).toBe("seo_gsc_response_too_large");
    fx.providerHook = () =>
      Response.json({
        successful: true,
        data: {
          ...INSPECTION,
          inspectionResult: {
            ...INSPECTION.inspectionResult,
            debug: { access_token: "ya29.fixture-secret" },
          },
        },
      });
    const leaked = await read(inspect());
    expect(leaked.status).toBe(502);
    expect(await leaked.text()).not.toContain("ya29.fixture-secret");
  });

  it("keeps a durable per-Task budget for each operation", async () => {
    for (let attempt = 0; attempt < 10; attempt++)
      expect((await read(sitesList)).status).toBe(200);
    expect((await read(sitesList)).status).toBe(429);
    expect(fx.reads).toHaveLength(10);
    expect((await read(query())).status).toBe(200);
    const budget = await prisma.projectSeoObservation.findFirstOrThrow({
      where: { auditId, kind: "task_gsc_read_budget" },
    });
    expect(budget).toMatchObject({
      ownerId,
      visibility: "PRIVATE",
      pageIds: [],
      sourceTaskId: null,
      payload: { "sites.list": 10, "searchAnalytics.query": 1 },
    });
  });

  it("leaves one audit entry for each read attempt, without page or query text", async () => {
    expectCoreLog("warn", "A Task-scoped Search Console read failed", 2);
    // The 503 and the 502 below, on the wide event that inRequest gives the read.
    expectCoreLog("error", "A request failed with a server error", 2);
    /** The audit entry of one read, taken from its request's wide event. */
    const auditOf = async (body: unknown, status: number) => {
      const before = coreLogEvents().length;
      await inRequest(async () =>
        expect((await read(body)).status).toBe(status),
      );
      const events = coreLogEvents()
        .slice(before)
        .filter((event) => event.audit);
      expect(events).toHaveLength(1);
      expect(JSON.stringify(events[0])).not.toMatch(/(example|private)\.test/);
      return events[0]!.audit;
    };
    const sha256 = expect.stringMatching(/^[0-9a-f]{64}$/);
    const replaceConnection = () =>
      prisma.seoConnection.update({
        where: { id: fx.connectionId },
        data: { revision: { increment: 1 } },
      });
    const restoreConnection = () =>
      prisma.seoConnection.update({
        where: { id: fx.connectionId },
        data: { revision: { decrement: 1 } },
      });
    const pageQuery = query({
      dimensions: ["query"],
      dimensionFilterGroups: [
        {
          filters: [
            { dimension: "page", operator: "equals", expression: PAGE_URLS[0] },
          ],
        },
      ],
    });
    expect(await auditOf(pageQuery, 200)).toMatchObject({
      action: "seo-task.search-console.read",
      actor: { type: "agent", id: coworkerId },
      outcome: "success",
      target: {
        type: "task",
        id: fx.taskId,
        expectedOwnerId: ownerId,
        expectedOrganizationId: organizationId,
        operation: "searchAnalytics.query",
        query: {
          startDate: day(-30),
          endDate: day(-3),
          dimensions: ["query"],
          rowLimit: 25_000,
          startRow: 0,
          filters: [
            { dimension: "page", operator: "equals", expressionSha256: sha256 },
          ],
        },
        providerStep: "answered",
        rows: ROWS.rows.length,
      },
    });
    // Refused at the gate: the provider step did not start.
    expect(
      await auditOf({ ...query(), siteUrl: "sc-domain:private.test" }, 409),
    ).toMatchObject({
      outcome: "denied",
      reason: "seo_gsc_property",
      target: { id: fx.taskId, providerStep: "not_started" },
    });
    // Google answered, and Core held the reply back.
    fx.providerHook = async () => {
      await replaceConnection();
      return null;
    };
    expect(await auditOf(inspect(), 409)).toMatchObject({
      outcome: "denied",
      reason: "seo_gsc_reconnect",
      target: {
        operation: "urlInspection.inspect",
        inspectionUrlSha256: sha256,
        providerStep: "answered",
      },
    });
    await restoreConnection();
    // Google answered, and Core refused the body.
    fx.providerHook = () =>
      Response.json({
        successful: true,
        data: {
          rows: [{ ...ROWS.rows[0], keys: ["x".repeat(2 * 1024 * 1024)] }],
        },
      });
    expect(await auditOf(query(), 502)).toMatchObject({
      outcome: "failure",
      reason: "seo_gsc_response_too_large",
      target: { providerStep: "answered" },
    });
    fx.providerHook = () => new Response("upstream failed", { status: 500 });
    expect(await auditOf(sitesList, 503)).toMatchObject({
      outcome: "failure",
      reason: "http_503",
      target: { operation: "sites.list", providerStep: "no_answer" },
    });
    // No answer, and the connection changed too: still no answer.
    fx.providerHook = async () => {
      await replaceConnection();
      return new Response("upstream failed", { status: 500 });
    };
    expect(await auditOf(sitesList, 409)).toMatchObject({
      outcome: "denied",
      reason: "seo_gsc_reconnect",
      target: { providerStep: "no_answer" },
    });
    await restoreConnection();
    fx.actor = { actor: "user", userId: ownerId, organizationId, role: "user" };
    expect(await auditOf(sitesList, 403)).toMatchObject({
      actor: { type: "user", id: ownerId },
      outcome: "denied",
      reason: "http_403",
      target: { providerStep: "not_started" },
    });
  });
});
