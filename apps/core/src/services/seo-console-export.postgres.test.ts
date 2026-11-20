import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { GSC_INSPECT_TOOL } from "@/lib/seo/native-gsc-inspection";
import { GSC_PROPERTIES_TOOL } from "@/lib/seo/native-statistics";
import type { SeoActor } from "@/schemas/project-seo.schema";
import { consoleExportSummary } from "@/schemas/seo-console-export.schema";
import { searchConsoleToolDescriptors } from "@/test-fixtures/seo-search-console";
import * as composio from "./composio-integration-tools.service";
import { createSeoAudit } from "./seo-audit.service";
import { connectionVersion } from "./seo-connections.service";
import { consoleExports } from "./seo-console-export";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const userId = randomUUID(),
  workspaceId = randomUUID(),
  projectId = randomUUID(),
  otherProjectId = randomUUID();
const pageUrl = "https://example.test/article";
const propertyId = "sc-domain:example.test";
let version: string;
const owner = { userId, workspaceId, organizationId: null };
async function audit(project: string) {
  const saved = await createSeoAudit(owner, {
    name: "Search Console exports",
    firstPage: { url: pageUrl, label: "Article", relationship: "primary" },
    projectId: project,
  });
  const auditId = saved.auditId!;
  const actor: SeoActor = { ...owner, owner: { kind: "audit", id: auditId } };
  const task = await prisma.task.create({
    data: {
      name: "Completed audit",
      workspaceId,
      projectId: project,
      ownerId: userId,
      creatorUserId: userId,
      status: "COMPLETED",
    },
  });
  await prisma.projectSeoAnalysis.create({
    data: {
      auditId,
      taskId: task.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      kind: "audit_full",
      status: "completed",
      requestedBy: userId,
      pageIds: saved.pages.map(({ id }) => id),
      request: {
        pageUrls: [pageUrl],
        searchConsoleAccess: { propertyId, connectionVersion: version },
      },
    },
  });
  return { actor, taskId: task.id };
}
const csv = (date: string, count: number) => ({
  kind: "linked_pages" as const,
  date,
  csv: `Target page,Incoming links,Linking sites\n${pageUrl},${count},1`,
});

describe.skipIf(!enabled)("private Search Console export history", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        email: userId + "@example.test",
        name: "CSV owner",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.project.createMany({
      data: [
        { id: projectId, workspaceId, name: "Search exports" },
        { id: otherProjectId, workspaceId, name: "Unrelated exports" },
      ],
    });
    const account = await prisma.seoConnection.create({
      data: {
        workspaceId,
        userId,
        provider: "search_console",
        status: "ACTIVE",
        composioAccountId: randomUUID(),
        entityId: randomUUID(),
      },
    });
    version = connectionVersion({
      composioAccountId: account.composioAccountId!,
      entityId: account.entityId!,
      connectionRevision: `native:${account.id}:${account.revision}`,
    });
    vi.spyOn(composio, "listIntegrationTools").mockResolvedValue(
      searchConsoleToolDescriptors(),
    );
    vi.spyOn(composio, "readIntegrationTool").mockImplementation(
      async (_account, slug) => {
        if (slug !== GSC_PROPERTIES_TOOL)
          throw new Error("Unrequested Google operation");
        return {
          siteEntry: [{ siteUrl: propertyId, permissionLevel: "siteOwner" }],
        };
      },
    );
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });
  it("compares the same property across audit runs, excludes unrelated projects and suppresses conflicting baselines", async () => {
    const earlier = await audit(projectId),
      current = await audit(projectId),
      foreign = await audit(otherProjectId);
    await consoleExports(earlier.actor, earlier.taskId, csv("2026-01-01", 2));
    await consoleExports(foreign.actor, foreign.taskId, csv("2026-01-02", 999));
    expect(await consoleExports(current.actor, current.taskId)).toEqual([]);
    const input = csv("2026-01-03", 4);
    const [summary] = await consoleExports(
      current.actor,
      current.taskId,
      input,
    );
    expect(summary).toMatchObject({
      previousDate: "2026-01-01",
      entries: [
        {
          key: pageUrl,
          counts: { incomingLinks: 4 },
          previousCounts: { incomingLinks: 2 },
        },
      ],
    });
    await consoleExports(current.actor, current.taskId, input);
    expect(
      await prisma.projectSeoObservation.count({
        where: {
          sourceTaskId: current.taskId,
          source: "search_console_csv",
          visibility: "PRIVATE",
          ownerId: userId,
        },
      }),
    ).toBe(1);
    await expect(
      consoleExports(current.actor, current.taskId, csv(input.date, 6)),
    ).rejects.toMatchObject({ status: 409 });
    const duplicate = await audit(projectId);
    await consoleExports(
      duplicate.actor,
      duplicate.taskId,
      csv("2026-01-01", 8),
    );
    expect(
      (await consoleExports(current.actor, current.taskId))[0].previousDate,
    ).toBeNull();
  });
  it("retries only unavailable examples after a cooldown and preserves the first successful inspection", async () => {
    const run = await audit(projectId);
    const second = "https://example.test/another";
    const input = {
      kind: "indexing_examples" as const,
      reason: "not_found" as const,
      date: "2026-01-05",
      inspectExamples: true as const,
      csv:
        "URL,Last crawled\n" +
        pageUrl +
        ",2026-01-04\n" +
        second +
        ",2026-01-04",
    };
    const upload = () => consoleExports(run.actor, run.taskId, input);
    const reads: unknown[] = [];
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await vi.mocked(composio.readIntegrationTool).withImplementation(
        async (_account, slug, args) => {
          if (slug === GSC_PROPERTIES_TOOL)
            return {
              siteEntry: [
                { siteUrl: propertyId, permissionLevel: "siteOwner" },
              ],
            };
          reads.push(args.inspection_url);
          if (args.inspection_url === second && reads.length === 2)
            throw new Error("Temporary Google error");
          return {
            inspectionResult: { indexStatusResult: { verdict: "PASS" } },
          };
        },
        async () => {
          const first = consoleExportSummary.parse((await upload())[0]);
          expect(first.entries[1].inspection?.status).toBe("unavailable");
          await upload();
          expect(reads).toEqual([pageUrl, second]);
          vi.setSystemTime(Date.now() + 6 * 60 * 1000);
          const recovered = consoleExportSummary.parse((await upload())[0]);
          expect(recovered.entries[0].inspection).toEqual(
            first.entries[0].inspection,
          );
          expect(recovered.entries[1].inspection?.status).toBe("observed");
          expect(reads).toEqual([pageUrl, second, second]);
        },
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it("reserves an inspection before Google reads, reuses the receipt, and frees a failed reservation", async () => {
    const run = await audit(projectId);
    const input = {
      kind: "indexing_examples" as const,
      reason: "not_found" as const,
      date: "2026-01-04",
      csv: "URL,Last crawled\n" + pageUrl + ",2026-01-03",
      inspectExamples: true as const,
    };
    const upload = () => consoleExports(run.actor, run.taskId, input);
    const provider = vi.mocked(composio.readIntegrationTool);
    provider.mockResolvedValueOnce({ siteEntry: [] });
    await expect(upload()).rejects.toMatchObject({ status: 403 });
    expect(await consoleExports(run.actor, run.taskId)).toEqual([]);
    const started = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    let reads = 0;
    await provider.withImplementation(
      async (_account, slug) => {
        if (slug === GSC_PROPERTIES_TOOL)
          return {
            siteEntry: [{ siteUrl: propertyId, permissionLevel: "siteOwner" }],
          };
        if (slug !== GSC_INSPECT_TOOL) throw new Error("Unexpected tool");
        if (++reads === 1) {
          started.resolve();
          await resume.promise;
        }
        return { inspectionResult: { indexStatusResult: { verdict: "PASS" } } };
      },
      async () => {
        const first = upload();
        try {
          await Promise.race([
            started.promise,
            first.then(() => {
              throw new Error("Inspection was not started");
            }),
          ]);
          await expect(upload()).rejects.toMatchObject({ status: 409 });
        } finally {
          resume.resolve();
          await first;
        }
        const [again] = await upload();
        expect(again.entries[0]).toMatchObject({
          key: pageUrl,
          inspection: { status: "observed", verdict: "PASS" },
        });
        expect(reads).toBe(1);
      },
    );
  });
});
