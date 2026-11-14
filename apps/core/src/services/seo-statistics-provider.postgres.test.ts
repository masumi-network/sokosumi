import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { runSeoTool } from "@/lib/soko-bot/seo-tools";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { nativeSeoMetricsSchema } from "@/schemas/project-seo-native-metrics.schema";
import {
  addProjectSeoPage,
  getProjectSeoWorkspace,
} from "./project-seo.service";

const provider = vi.hoisted(() => ({
  reads: [] as Array<{ slug: string; args: Record<string, unknown> }>,
}));
vi.mock(
  "@/services/composio-integration-tools.service",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/services/composio-integration-tools.service")
    >()),
    listIntegrationTools: async () => [
      {
        slug: "GOOGLE_ANALYTICS_LIST_ACCOUNT_SUMMARIES",
        readOnly: true,
        inputSchema: { properties: { pageSize: {}, pageToken: {} } },
      },
      {
        slug: "GOOGLE_ANALYTICS_RUN_REPORT",
        readOnly: true,
        inputSchema: {
          properties: {
            property: {},
            dateRanges: {},
            dimensions: {},
            metrics: {},
            dimensionFilter: {},
            limit: { type: "integer" },
            returnPropertyQuota: {},
          },
          required: ["property"],
        },
      },
    ],
    readIntegrationTool: async (
      _integration: unknown,
      slug: string,
      args: Record<string, unknown>,
    ) => {
      provider.reads.push({ slug, args });
      const dimensions = (args.dimensions ?? []) as Array<{ name: string }>;
      const data = slug.endsWith("SUMMARIES")
        ? {
            accountSummaries: [
              {
                propertySummaries: [
                  {
                    property: "properties/123",
                    displayName: "Isolated fixture",
                  },
                ],
              },
            ],
          }
        : dimensions[0]?.name === "hostName"
          ? {
              dimensionHeaders: [{ name: "hostName" }],
              metricHeaders: [{ name: "sessions" }],
              rowCount: 1,
              rows: [
                {
                  dimensionValues: [{ value: "example.org" }],
                  metricValues: [{ value: "5" }],
                },
              ],
            }
          : dimensions[0]?.name === "landingPagePlusQueryString"
            ? {
                dimensionHeaders: [{ name: "landingPagePlusQueryString" }],
                metricHeaders: [{ name: "sessions" }, { name: "keyEvents" }],
                rows: [
                  {
                    dimensionValues: [{ value: "/pricing" }],
                    metricValues: [{ value: "5" }, { value: "2" }],
                  },
                ],
              }
            : {
                dimensionHeaders: dimensions.length ? [{ name: "date" }] : [],
                metricHeaders: [
                  "screenPageViews",
                  "activeUsers",
                  "sessions",
                  "userEngagementDuration",
                ].map((name) => ({ name })),
                rows: [
                  {
                    dimensionValues: dimensions.length
                      ? [{ value: "20260101" }]
                      : [],
                    metricValues: ["6", "3", "4", "10"].map((value) => ({
                      value,
                    })),
                  },
                ],
                metadata: { timeZone: "Europe/Oslo" },
              };
      return { successful: true, data };
    },
  }),
);

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const userId = randomUUID(),
  workspaceId = randomUUID(),
  projectId = randomUUID();
const actor: SeoActor = {
  owner: { kind: "project", id: projectId },
  userId,
  workspaceId,
  organizationId: null,
};
let pageId: string;
const query = () => ({
  projectId,
  provider: "ga4",
  propertyId: "properties/123",
  pageIds: [pageId],
  from: "2026-01-01",
  to: "2026-01-02",
  channel: "all",
});

describe.skipIf(!enabled)(
  "native SEO statistics provider boundary with PostgreSQL",
  () => {
    beforeAll(async () => {
      await prisma.user.create({
        data: {
          id: userId,
          name: "Isolated statistics owner",
          email: `${userId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          workspace: { create: { id: workspaceId } },
        },
      });
      await prisma.project.create({
        data: { id: projectId, workspaceId, name: "Isolated statistics" },
      });
      pageId = (
        await addProjectSeoPage(actor, {
          url: "https://example.org/pricing",
          relationship: "primary",
        })
      ).id;
      await prisma.seoConnection.create({
        data: {
          workspaceId,
          userId,
          provider: "ga4",
          status: "ACTIVE",
          entityId: `fixture:${userId}`,
          composioAccountId: `fixture:${randomUUID()}`,
        },
      });
    });
    afterAll(async () => {
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });

    it("runs real tool validation, property selection, normalization and private metric storage", async () => {
      provider.reads.length = 0;
      const authorized: string[] = [],
        committed: string[] = [];
      await runSeoTool("sync_seo_statistics", query(), actor, {
        authorize: async () => {
          authorized.push("authorized");
        },
        commit: async (_tx, id) => {
          committed.push(id);
        },
      });
      const stored = await prisma.projectSeoObservation.findMany({
        where: { projectId, kind: "metrics" },
      });
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        ownerId: userId,
        visibility: "PRIVATE",
        pageIds: [pageId],
        source: "ga4",
      });
      const payload = nativeSeoMetricsSchema.parse(stored[0]!.payload);
      expect(payload).toMatchObject({
        provider: "ga4",
        propertyId: "properties/123",
        from: "2026-01-01",
        to: "2026-01-02",
      });
      expect(payload.metrics[0]).toMatchObject({
        key: "page_views",
        value: 6,
        previous: { from: "2025-12-30", to: "2025-12-31", value: 6 },
      });
      expect(payload.landingPages).toMatchObject({
        verifiedHost: "example.org",
      });
      expect((await getProjectSeoWorkspace(actor)).metrics[0]).toMatchObject({
        key: "page_views",
        value: 6,
      });
      expect(provider.reads).toHaveLength(6);
      expect(provider.reads[0]?.slug).toBe(
        "GOOGLE_ANALYTICS_LIST_ACCOUNT_SUMMARIES",
      );
      expect(authorized).toEqual(["authorized"]);
      expect(committed).toEqual([stored[0]!.id]);
    });

    it("rejects a guessed property before metric reads or another persisted observation", async () => {
      provider.reads.length = 0;
      const before = await prisma.projectSeoObservation.count({
        where: { projectId },
      });
      await expect(
        runSeoTool(
          "sync_seo_statistics",
          { ...query(), propertyId: "properties/456" },
          actor,
          {},
        ),
      ).rejects.toMatchObject({ status: 422 });
      expect(provider.reads.map((read) => read.slug)).toEqual([
        "GOOGLE_ANALYTICS_LIST_ACCOUNT_SUMMARIES",
      ]);
      expect(
        await prisma.projectSeoObservation.count({ where: { projectId } }),
      ).toBe(before);
    });
  },
);
