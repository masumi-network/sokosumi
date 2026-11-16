import { randomUUID } from "node:crypto";
import { Prisma } from "@sokosumi/database";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getEnv } from "@/config/env";
import { applyGuardedTaskStatusUpdate } from "@/helpers/task-event-charge";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  requestSeoAnalysisSchema,
  type SeoActor,
} from "@/schemas/project-seo.schema";
import { addProjectSeoPage } from "./project-seo.service";
import { createProjectSeoMonitor } from "./project-seo-monitor.service";
import {
  requestProjectSeoAnalysis,
  requestProjectSeoAnalysisInTransaction,
} from "./project-seo-operations.service";
import { restoreTaskRecord } from "./task-domain.service";
import { taskScheduleReleaseService } from "./task-schedule-runs.service";

vi.mock("@/lib/ably/publish", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ably/publish")>()),
  publishTaskEventData: vi.fn(async () => undefined),
}));
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const userId = randomUUID(),
  workspaceId = randomUUID(),
  auditId = randomUUID(),
  vendorId = randomUUID(),
  coworkerId = randomUUID();
const actor: SeoActor = {
  owner: { kind: "audit", id: auditId },
  userId,
  workspaceId,
  organizationId: null,
};
const env = getEnv(),
  previousExecutor = env.SEO_ANALYSIS_EXECUTOR,
  previousDispatch = env.SEO_ANALYSIS_DISPATCH_ENABLED;
let pageId: string, secondPageId: string;
function request(kind: "page_check" | "audit_lite" = "page_check") {
  return requestSeoAnalysisSchema.parse({
    kind,
    pageIds: [pageId],
    countryCode: "US",
    languageCode: "en",
    maxProviderCalls: 0,
    idempotencyKey: randomUUID(),
  });
}
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe.skipIf(!enabled)("one active SEO check per audit", () => {
  beforeAll(async () => {
    env.SEO_ANALYSIS_DISPATCH_ENABLED = true;
    env.SEO_ANALYSIS_EXECUTOR = {
      coworkerId,
      workspaceId,
      ownerId: userId,
      organizationId: null,
      canUsePaidSearchData: true,
      canSchedule: true,
    };
    await prisma.user.create({
      data: {
        id: userId,
        name: "SEO credit owner",
        email: `${userId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.seoAudit.create({
      data: { id: auditId, workspaceId, createdById: userId, name: "Credits" },
    });
    await prisma.vendor.create({
      data: { id: vendorId, slug: vendorId, name: "SEO credit vendor" },
    });
    await prisma.coworker.create({
      data: {
        id: coworkerId,
        slug: coworkerId,
        name: "SEO checks",
        vendorId,
        isWhitelisted: true,
        capabilities: ["tasks"],
      },
    });
    pageId = (
      await addProjectSeoPage(actor, {
        url: "https://example.test/credits",
        relationship: "primary",
      })
    ).id;
    secondPageId = (
      await addProjectSeoPage(actor, {
        url: "https://example.test/credits/second",
        relationship: "related",
      })
    ).id;
  });
  beforeEach(async () => {
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.taskSchedule.deleteMany({ where: { workspaceId } });
    await prisma.projectSeoAnalysis.deleteMany({ where: { auditId } });
  });
  afterAll(async () => {
    env.SEO_ANALYSIS_EXECUTOR = previousExecutor;
    env.SEO_ANALYSIS_DISPATCH_ENABLED = previousDispatch;
    await prisma.task.deleteMany({ where: { workspaceId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.coworker.deleteMany({ where: { vendorId } });
    await prisma.vendor.delete({ where: { id: vendorId } });
  });
  it("rejects a different kind and page while an audit Task is active", async () => {
    await requestProjectSeoAnalysis(actor, request());
    await expect(
      requestProjectSeoAnalysis(actor, {
        ...request("audit_lite"),
        pageIds: [secondPageId],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await prisma.projectSeoAnalysis.count({ where: { auditId } })).toBe(
      1,
    );
  });
  it("returns an idempotent retry while the same Task is active", async () => {
    const input = request(),
      first = await requestProjectSeoAnalysis(actor, input);
    expect((await requestProjectSeoAnalysis(actor, input)).id).toBe(first.id);
  });
  it.each(["COMPLETED", "FAILED", "CANCELED"] as const)(
    "frees the slot for a %s Task even when analysis status is stale",
    async (status) => {
      const first = await requestProjectSeoAnalysis(actor, request());
      await prisma.task.update({
        where: { id: first.taskId! },
        data: { status },
      });
      expect((await requestProjectSeoAnalysis(actor, request())).id).not.toBe(
        first.id,
      );
    },
  );
  it("does not block another audit in the Workspace", async () => {
    await requestProjectSeoAnalysis(actor, request());
    const audit = await prisma.seoAudit.create({
        data: { workspaceId, createdById: userId, name: "Other" },
      }),
      otherActor: SeoActor = {
        ...actor,
        owner: { kind: "audit", id: audit.id },
      };
    const page = await addProjectSeoPage(otherActor, {
      url: "https://example.test/other",
      relationship: "primary",
    });
    expect(
      (
        await requestProjectSeoAnalysis(otherActor, {
          ...request(),
          pageIds: [page.id],
        })
      ).taskId,
    ).not.toBeNull();
  });
  it.each([
    Prisma.TransactionIsolationLevel.ReadCommitted,
    Prisma.TransactionIsolationLevel.Serializable,
  ])(
    "rejects a stale snapshot after a concurrent %s dispatch",
    async (isolationLevel) => {
      const holding = barrier(),
        release = barrier(),
        snapshot = barrier();
      let firstPid: number | undefined, secondPid: number | undefined;
      const first = prisma.$transaction(
        (tx) =>
          requestProjectSeoAnalysisInTransaction(actor, request(), tx, {
            authorize: async (current) => {
              firstPid = (
                await current.$queryRaw<
                  Array<{ pid: number }>
                >`SELECT pg_backend_pid() AS pid`
              )[0].pid;
              holding.resolve();
              await release.promise;
            },
          }),
        { isolationLevel, timeout: 10000 },
      );
      await holding.promise;
      const input = request("audit_lite");
      let attempt = 0;
      const second = serializableTransaction(async (tx) => {
        secondPid ??= (
          await tx.$queryRaw<
            Array<{ pid: number }>
          >`SELECT pg_backend_pid() AS pid`
        )[0].pid;
        await tx.$queryRaw`SELECT id FROM "seo_audit" WHERE id=${auditId}::uuid`;
        if (attempt++ === 0) snapshot.resolve();
        return requestProjectSeoAnalysisInTransaction(actor, input, tx);
      }, "Retry check");
      await snapshot.promise;
      release.resolve();
      const results = await Promise.allSettled([first, second]);
      expect(firstPid).not.toBe(secondPid);
      expect(results[0].status).toBe("fulfilled");
      expect(results[1]).toMatchObject({
        status: "rejected",
        reason: { status: 409 },
      });
      expect(
        await prisma.projectSeoAnalysis.count({ where: { auditId } }),
      ).toBe(1);
    },
  );
  it("releases a monitor backlog one Run at a time without rolling back its first Task", async () => {
    const vars = {
      isAuthenticated: true,
      authContext: {
        actor: "user" as const,
        userId,
        organizationId: null,
        role: "user",
      },
      workspaceContext: { workspaceId, userId, organizationId: null },
    };
    const monitor = await createProjectSeoMonitor(vars, actor, {
      operationId: randomUUID(),
      rule: {
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "AFTER",
        targetRunCount: 2,
      },
      analysis: request(),
    });
    const runs = await prisma.taskScheduleRun.findMany({
      where: { scheduleId: monitor.id },
      orderBy: { effectiveScheduledAt: "asc" },
    });
    expect(runs).toHaveLength(2);
    const day = 86400000;
    for (const [index, run] of runs.entries()) {
      const at = new Date(Date.now() - (2 - index) * day);
      await prisma.taskScheduleRun.update({
        where: { id: run.id },
        data: { originalScheduledAt: at, effectiveScheduledAt: at },
      });
    }
    await prisma.taskSchedule.update({
      where: { id: monitor.id },
      data: { nextRunAt: new Date(Date.now() - 2 * day) },
    });
    const tick = () =>
      taskScheduleReleaseService.releaseDueSchedules({
        abortSignal: new AbortController().signal,
        deadlineMs: Date.now() + 10000,
        shouldContinue: () => true,
      });
    expect((await tick()).released).toBe(1);
    const released = await prisma.taskScheduleRun.findUniqueOrThrow({
      where: { id: runs[0].id },
    });
    expect(released.state).toBe("RELEASED");
    expect((await tick()).released).toBe(0);
    expect(
      (
        await prisma.taskScheduleRun.findUniqueOrThrow({
          where: { id: runs[1].id },
        })
      ).state,
    ).toBe("PLANNED");
    expect(
      (
        await prisma.taskScheduleRun.findUniqueOrThrow({
          where: { id: runs[0].id },
        })
      ).releasedTaskId,
    ).toBe(released.releasedTaskId);
    await prisma.task.update({
      where: { id: released.releasedTaskId! },
      data: { status: "COMPLETED" },
    });
    expect((await tick()).released).toBe(1);
    expect(
      (
        await prisma.taskSchedule.findUniqueOrThrow({
          where: { id: monitor.id },
        })
      ).state,
    ).toBe("ENDED");
  });
  it("guards restoration of an archived waiting check and permits it after the other check ends", async () => {
    const earlier = await requestProjectSeoAnalysis(actor, request());
    await prisma.task.update({
      where: { id: earlier.taskId! },
      data: { archivedAt: new Date() },
    });
    const current = await requestProjectSeoAnalysis(actor, request());
    const archived = await prisma.task.findUniqueOrThrow({
      where: { id: earlier.taskId! },
    });
    const restore = () =>
      prisma.$transaction((tx) =>
        restoreTaskRecord(tx, archived, { kind: "user", userId }),
      );
    await expect(restore()).rejects.toMatchObject({ status: 409 });
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: earlier.taskId! } }))
        .archivedAt,
    ).not.toBeNull();
    await prisma.task.update({
      where: { id: current.taskId! },
      data: { status: "COMPLETED" },
    });
    await restore();
    expect(
      await prisma.task.findUniqueOrThrow({ where: { id: earlier.taskId! } }),
    ).toMatchObject({ archivedAt: null, status: "DRAFT" });
  });
  it.each(["COMPLETED", "CANCELED", "FAILED"] as const)(
    "guards reopening a %s check until another check finishes",
    async (status) => {
      const earlier = await requestProjectSeoAnalysis(actor, request());
      await prisma.task.update({
        where: { id: earlier.taskId! },
        data: { status },
      });
      const current = await requestProjectSeoAnalysis(actor, request());
      const reopen = () =>
        prisma.$transaction((tx) =>
          applyGuardedTaskStatusUpdate({
            tx,
            taskId: earlier.taskId!,
            expectedStatus: status,
            eventStatus: "READY",
          }),
        );
      await expect(reopen()).rejects.toMatchObject({ status: 409 });
      await prisma.task.update({
        where: { id: current.taskId! },
        data: { status: "COMPLETED" },
      });
      await reopen();
      expect(
        (
          await prisma.task.findUniqueOrThrow({
            where: { id: earlier.taskId! },
          })
        ).status,
      ).toBe("READY");
    },
  );
});
