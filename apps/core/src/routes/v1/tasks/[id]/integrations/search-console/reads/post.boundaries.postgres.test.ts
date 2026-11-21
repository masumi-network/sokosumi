/** Boundary cases of the Task-scoped Search Console reads, beside post.postgres.test.ts. */
import { describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { importProjectSeoAudit } from "@/services/project-seo-import.service";
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

describe.skipIf(!searchConsoleReadsEnabled)(
  "Task-scoped Search Console read boundaries",
  () => {
    const fx = searchConsoleReadFixture(network, ids.executor);
    const { query, read, setAccess } = fx;
    it("accepts a start date 489 days back and refuses one 501 days back", async () => {
      const sixteenMonths = await read(query({ startDate: day(-489) }));
      expect(sixteenMonths.status, await sixteenMonths.clone().text()).toBe(
        200,
      );
      expect((await read(query({ startDate: day(-501) }))).status).toBe(422);
      expect(fx.reads).toHaveLength(1);
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
    });
  },
);
