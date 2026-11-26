/** Boundary cases of the Task-scoped Search Console reads, beside post.postgres.test.ts. */
import { describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { importProjectSeoAudit } from "@/services/project-seo-import.service";
import { expectCoreLog } from "@/test/core-log";
import { legacyReport, siteStrategyReport } from "@/test-fixtures/project-seo";
import {
  day,
  PAGE_URLS,
  PROPERTY,
  searchConsoleReadFixture,
  searchConsoleReadsEnabled,
} from "@/test-fixtures/seo-task-search-console-reads";

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

const BUDGET_KIND = "task_gsc_read_budget";

describe.skipIf(!searchConsoleReadsEnabled)(
  "Task-scoped Search Console read boundaries",
  () => {
    const fx = searchConsoleReadFixture(network, ids.executor);
    const { sitesList, query, inspect, read, setAccess, kindOf } = fx;
    const budgetRow = () =>
      prisma.projectSeoObservation.findFirstOrThrow({
        where: { auditId: fx.auditId, kind: BUDGET_KIND },
      });
    async function seedBudget(payload: Record<string, unknown>) {
      // One real read creates the row the way the service writes it.
      expect((await read(sitesList)).status).toBe(200);
      await prisma.projectSeoObservation.update({
        where: { id: (await budgetRow()).id },
        data: { payload: payload as never },
      });
    }

    it("accepts a start date 489 days back and refuses one 501 days back", async () => {
      const sixteenMonths = await read(query({ startDate: day(-489) }));
      expect(sixteenMonths.status, await sixteenMonths.clone().text()).toBe(
        200,
      );
      expect((await read(query({ startDate: day(-501) }))).status).toBe(422);
      expect(fx.reads).toHaveLength(1);
    });

    it("lets the 60th inspection and the 400th query pass, then gives 429", async () => {
      await seedBudget({
        "sites.list": 1,
        "urlInspection.inspect": 59,
        "searchAnalytics.query": 399,
      });
      expect((await read(inspect())).status).toBe(200);
      expect((await read(inspect())).status).toBe(429);
      expect((await read(query())).status).toBe(200);
      expect((await read(query())).status).toBe(429);
      expect(fx.reads).toHaveLength(3);
      expect((await budgetRow()).payload).toEqual({
        "sites.list": 1,
        "urlInspection.inspect": 60,
        "searchAnalytics.query": 400,
      });
    });

    it("refuses a corrupt budget row instead of resetting the spent count", async () => {
      await seedBudget({ "sites.list": "9" });
      const response = await read(sitesList);
      expect(response.status).toBe(409);
      expect(await response.text()).not.toContain("siteEntry");
      expect(fx.reads).toHaveLength(1);
      expect((await budgetRow()).payload).toEqual({ "sites.list": "9" });
    });

    it("spends budget on a failed provider call", async () => {
      expectCoreLog("warn", "A Task-scoped Search Console read failed");
      fx.providerHook = () => new Response("upstream failed", { status: 500 });
      expect((await read(query())).status).toBe(503);
      expect((await budgetRow()).payload).toEqual({
        "searchAnalytics.query": 1,
      });
    });

    it("returns no Google body when the Task leaves RUNNING during the provider call", async () => {
      fx.providerHook = async () => {
        await prisma.task.update({
          where: { id: fx.taskId },
          data: { status: "COMPLETED" },
        });
        return null;
      };
      const response = await read(query());
      expect(response.status).toBe(409);
      expect(await response.text()).not.toContain("widget");
      expect(fx.reads).toHaveLength(1);
    });

    it("binds a URL-prefix property exactly", async () => {
      const prefix = "https://example.test/";
      const analysis = await prisma.projectSeoAnalysis.findUniqueOrThrow({
        where: { taskId: fx.taskId },
      });
      const { searchConsoleAccess } = analysis.request as {
        searchConsoleAccess: Record<string, unknown>;
      };
      await setAccess({ ...searchConsoleAccess, propertyId: prefix });
      const rows = await read({ ...query(), siteUrl: prefix });
      expect(rows.status, await rows.clone().text()).toBe(200);
      expect((await read({ ...inspect(), siteUrl: prefix })).status).toBe(200);
      for (const body of [
        { ...query(), siteUrl: PROPERTY },
        { ...query(), siteUrl: "https://example.test/a/" },
        { ...query(), siteUrl: "http://example.test/" },
        {
          ...inspect("https://www.example.test/a"),
          siteUrl: prefix,
        },
      ]) {
        const response = await read(body);
        expect(response.status, JSON.stringify(body)).toBe(409);
        expect(await kindOf(response)).toBe("seo_gsc_property");
      }
      expect(fx.reads.map((entry) => entry.input.arguments)).toEqual([
        expect.objectContaining({ site_url: prefix }),
        { site_url: prefix, inspection_url: PAGE_URLS[0] },
      ]);
    });

    describe("the owner's report choices", () => {
      const budget = () =>
        prisma.projectSeoObservation.findFirst({
          where: { auditId: fx.auditId, kind: BUDGET_KIND },
        });
      async function expectScopeRefusal(body: unknown) {
        const response = await read(body);
        const text = await response.text();
        expect(response.status, JSON.stringify(body)).toBe(422);
        expect(text).toContain("audited pages only");
        expect(JSON.parse(text).kind).toBeUndefined();
      }

      it("refuses a property-wide query without the owner's choice, and spends no budget", async () => {
        await fx.setScope({});
        await expectScopeRefusal(query());
        expect(await budget()).toBeNull();
        expect(fx.reads).toEqual([]);
        expect(network.tools).not.toHaveBeenCalled();
        // A later refusal leaves a spent budget as it was.
        expect((await read(sitesList)).status).toBe(200);
        await expectScopeRefusal(query({ dimensions: ["date"] }));
        expect((await budget())?.payload).toEqual({ "sites.list": 1 });
      });

      it("reads an audit page and its www or https form without the owner's choice", async () => {
        await fx.setScope({});
        for (const url of [
          PAGE_URLS[0],
          "https://www.example.test/a",
          "http://example.test/a/",
        ]) {
          const response = await read(fx.pageQuery(url));
          expect(response.status, url).toBe(200);
        }
        expect(fx.reads).toHaveLength(3);
      });

      it("refuses another page of the property without the owner's choice", async () => {
        await fx.setScope({});
        await expectScopeRefusal(fx.pageQuery("https://example.test/private"));
        await expectScopeRefusal(
          fx.pageQuery(PAGE_URLS[0], {
            dimensionFilterGroups: [
              { filters: [{ dimension: "page", expression: PAGE_URLS[0] }] },
            ],
          }),
        );
        await expectScopeRefusal(inspect("https://example.test/private"));
        expect((await read(inspect())).status).toBe(200);
        expect(fx.reads).toHaveLength(1);
      });

      it("reads property totals but no page list with only the totals choice", async () => {
        await fx.setScope({ includePropertyTotals: true });
        const totals = await read(query({ dimensions: ["date"] }));
        expect(totals.status, await totals.clone().text()).toBe(200);
        await expectScopeRefusal(query({ dimensions: ["query", "page"] }));
        await expectScopeRefusal(fx.pageQuery("https://example.test/private"));
        await expectScopeRefusal(inspect("https://example.test/private"));
        expect(fx.reads).toHaveLength(1);
      });
    });

    it("refuses a request body over 64 KiB with 413", async () => {
      const response = await read({
        ...sitesList,
        padding: "x".repeat(64 * 1024),
      });
      expect(response.status).toBe(413);
      expect(fx.reads).toEqual([]);
    });

    it("imports a report with Search Console sections only for an audit approved with Search Console", async () => {
      await prisma.task.update({
        where: { id: fx.taskId },
        data: { status: "COMPLETED" },
      });
      const decisions = {
        privateStrategyDecisions: [{ decision: "fixture-strategy-marker" }],
      };
      const report = {
        ...siteStrategyReport(),
        searchConsole: { clicks: 3 },
        ...decisions,
        pages: PAGE_URLS.map((url) => ({
          ...legacyReport(),
          request: { url, connections: ["search_console"] },
          searchConsole: { totals: { clicks: 3 } },
          sourceFailures: ["webRiskNotRun", "provider message"],
          ...decisions,
          header: {
            ...legacyReport().header,
            focusKeywords: legacyReport().header.focusKeywords.map((row) => ({
              ...row,
              searchConsole: { desktop: null },
              searchConsoleNote: { desktop: "fewer than 10 impressions" },
            })),
          },
        })),
      };
      // Only the strategy decisions, so a refusal can come from no other field.
      const decisionsOnly = {
        ...siteStrategyReport(),
        ...decisions,
        pages: PAGE_URLS.map((url) => ({
          ...legacyReport(),
          request: { url },
        })),
      };
      const owner = {
        owner: { kind: "audit" as const, id: fx.auditId },
        workspaceId: fx.workspaceId,
        organizationId: fx.organizationId,
        userId: fx.ownerId,
      };
      let files = 0;
      const importReport = async (value: unknown) => {
        const body = JSON.stringify(value);
        files += 1;
        const file = await prisma.taskFile.create({
          data: {
            taskId: fx.taskId,
            name: `seo-report-${fx.taskId}.json`,
            fileUrl: `https://seo-test.public.blob.vercel-storage.com/tasks/${fx.taskId}/report-${files}.json`,
            mimeType: "application/json",
            size: BigInt(Buffer.byteLength(body)),
            uploadedByCoworkerId: fx.coworkerId,
          },
        });
        return importProjectSeoAudit(
          owner,
          { taskId: fx.taskId, fileId: file.id },
          { fetchImpl: async () => new Response(body) },
        );
      };
      await setAccess(null);
      for (const value of [report, decisionsOnly])
        await expect(importReport(value)).rejects.toMatchObject({
          status: 400,
        });
      await setAccess({
        propertyId: PROPERTY,
        connectionVersion: "0".repeat(64),
      });
      const imported = await importReport(report);
      expect(JSON.stringify(imported.payload)).not.toMatch(
        /searchConsole|search_console|impressions|fixture-strategy-marker/,
      );
      // The admin alerts read the worker's source codes from the stored report.
      expect(imported.payload).toMatchObject({
        sourceFailures: ["webRiskNotRun"],
      });
    });
  },
);
