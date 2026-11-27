import "@hono/zod-openapi";

import { randomUUID } from "node:crypto";
import type { Job } from "@sokosumi/database";
import type { SokoBotRuntime } from "@sokosumi/soko-bot";
import { Client } from "pg";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { expectCoreLog } from "@/test/core-log";
import { recordStatements } from "@/test/record-statements";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

const flag = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/network", async (original) => ({
  ...(await original<typeof import("@/lib/network")>()),
  isPreprodOn: () => flag.on,
}));
vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const staleKind = "soko_bot_network_stale";

describe.skipIf(!enabled)("detached schedules on PostgreSQL", () => {
  let prisma: typeof import("@/lib/db/prisma").default;
  let control: typeof import("@/helpers/preprod-control");
  let controlPlane: typeof import("./soko-bot-control-plane.service").sokoBotControlPlane;
  let cron: typeof import("./soko-bot-schedules-sync.service").sokoBotSchedulesSyncService;
  let createPersonalWorkspace: typeof import("@/helpers/personal-workspace").createPersonalWorkspace;
  let createNetworkScope: typeof import("@/lib/db/network-scope").createNetworkScope;
  let makeControl: typeof import("./soko-bot-control-plane.service").SokoBotControlPlane;
  let presetClassificationResult: typeof import("@/lib/soko-bot/classifier").presetClassificationResult;

  beforeAll(async () => {
    flag.on = onSplitLayout;
    vi.stubEnv("NETWORK_PREPROD_ENABLED", String(onSplitLayout));
    ({ default: prisma } = await import("@/lib/db/prisma"));
    ({ createPersonalWorkspace } = await import(
      "@/helpers/personal-workspace"
    ));
    ({ createNetworkScope } = await import("@/lib/db/network-scope"));
    ({ sokoBotControlPlane: controlPlane, SokoBotControlPlane: makeControl } =
      await import("./soko-bot-control-plane.service"));
    ({ sokoBotSchedulesSyncService: cron } = await import(
      "./soko-bot-schedules-sync.service"
    ));
    ({ presetClassificationResult } = await import(
      "@/lib/soko-bot/classifier"
    ));
    control = await import("@/helpers/preprod-control");
  }, 60_000);

  afterAll(() => vi.unstubAllEnvs());

  function keys() {
    return [control.PREPROD_PAUSE_KEY, control.PREPROD_GENERATION_KEY];
  }

  async function setControl(pause = "open", generation = "7") {
    const before = await prisma.syncMetadata.findMany({
      where: { key: { in: keys() } },
    });
    onTestFinished(async () => {
      await prisma.syncMetadata.deleteMany({ where: { key: { in: keys() } } });
      await prisma.syncMetadata.createMany({ data: before });
    });
    for (const [index, cursorId] of [pause, generation].entries()) {
      const key = keys()[index];
      await prisma.syncMetadata.upsert({
        where: { key },
        create: { key, cursorId, lastSyncedAt: new Date() },
        update: { cursorId },
      });
    }
  }

  async function seed(options: {
    network: "mainnet" | "preprod" | null;
    job?: "mainnet" | "both";
    run?: "FAILED" | "PENDING";
  }) {
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        name: "Schedule resume owner",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const mainnet = createNetworkScope("mainnet").networkDb;
    const jobs: Array<{
      network: "mainnet" | "preprod";
      jobId: string;
      agentId: string;
      pricingId: string;
    }> = [];
    onTestFinished(async () => {
      await prisma.$transaction(async (tx) => {
        // The audit is append-only, including when its user is erased.
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.sokoBotAdminAction.deleteMany({
          where: { operatorId: userId },
        });
      });
      await prisma.sokoBotSchedule.deleteMany({
        where: { requestedByUserId: userId },
      });
      for (const job of jobs) {
        const db = createNetworkScope(job.network).networkDb;
        await db.job.delete({ where: { id: job.jobId } });
        await db.agent.delete({ where: { id: job.agentId } });
        await db.agentPricing.delete({ where: { id: job.pricingId } });
      }
      await mainnet.sokoBotUsage.deleteMany({ where: { userId } });
      await mainnet.creditBucket.deleteMany({ where: { userId } });
      await mainnet.transaction.deleteMany({ where: { userId } });
      await prisma.subscription.deleteMany({ where: { referenceId: userId } });
      await prisma.chatRoom.deleteMany({ where: { createdByUserId: userId } });
      await prisma.user.delete({ where: { id: userId } });
    });
    const { id: workspaceId } = await createPersonalWorkspace(userId);
    const bot = await prisma.sokoBot.create({
      data: { userId, workspaceId, proactiveDailyLimit: 100 },
    });
    const jobId = options.job ? randomUUID() : null;
    let mainnetJob: Job | null = null;
    if (jobId) {
      const networks =
        options.job === "both"
          ? (["mainnet", "preprod"] as const)
          : (["mainnet"] as const);
      // The split fixture's shared FK still points at Mainnet (ticket 54).
      for (const network of networks) {
        const db = createNetworkScope(network).networkDb;
        const agent = await db.agent.create({
          data: {
            blockchainIdentifier: randomUUID(),
            name: `Schedule agent ${network}`,
            isShown: false,
            lastUptimeCheck: new Date(),
            uptimeCount: 1,
            uptimeCheckCount: 1,
            pricing: { create: { pricingType: "FREE" } },
          },
        });
        const job = await db.job.create({
          data: {
            id: jobId,
            workspaceId,
            ownerId: userId,
            agentId: agent.id,
            agentJobId: randomUUID(),
            jobType: "FREE",
            name: `Schedule Job ${network}`,
          },
        });
        if (network === "mainnet") mainnetJob = job;
        jobs.push({
          network,
          jobId,
          agentId: agent.id,
          pricingId: agent.pricingId,
        });
      }
    }
    const schedule = await prisma.sokoBotSchedule.create({
      data: {
        sokoBotId: bot.id,
        workspaceId,
        requestedByUserId: userId,
        name: "Schedule test",
        cronExpression: "0 * * * *",
        timezone: "UTC",
        prompt: "Check the board.",
        runOnce: true,
        enabled: options.run === undefined,
        nextRunAt: new Date(Date.now() - 60_000),
        jobId,
        network: options.network,
        preprodGeneration: options.network === "preprod" ? 7 : null,
      },
    });
    const run = options.run
      ? await prisma.sokoBotScheduleRun.create({
          data: {
            scheduleId: schedule.id,
            scheduledFor: schedule.nextRunAt,
            prompt: schedule.prompt,
            status: options.run,
            attempt: 1,
            completedAt: options.run === "FAILED" ? new Date() : null,
          },
        })
      : null;
    return { bot, userId, workspaceId, schedule, run, mainnet, mainnetJob };
  }

  type Fixture = Awaited<ReturnType<typeof seed>>;

  function tick(scheduleId?: string) {
    return cron.syncDueSchedules({ scheduleId, shouldContinue: () => true });
  }

  function scheduleOf(fixture: Fixture) {
    return prisma.sokoBotSchedule.findUniqueOrThrow({
      where: { id: fixture.schedule.id },
    });
  }

  function runsOf(fixture: Fixture) {
    return prisma.sokoBotScheduleRun.findMany({
      where: { scheduleId: fixture.schedule.id },
      orderBy: { scheduledFor: "asc" },
    });
  }

  async function expectNoCharges(fixture: Fixture) {
    expect(
      await fixture.mainnet.transaction.count({
        where: { userId: fixture.userId, amount: { lt: 0 } },
      }),
    ).toBe(0);
    if (fixture.mainnetJob) {
      expect(
        await fixture.mainnet.job.findUnique({
          where: { id: fixture.mainnetJob.id },
        }),
      ).toEqual(fixture.mainnetJob);
    }
  }

  async function fund(fixture: Fixture) {
    const grant = await fixture.mainnet.transaction.create({
      data: { userId: fixture.userId, amount: 100_000n * 10_000_000_000n },
    });
    await fixture.mainnet.creditBucket.create({
      data: {
        userId: fixture.userId,
        sourceTransactionId: grant.id,
        amount: grant.amount,
      },
    });
  }

  /** A deterministic runtime and classifier for the complete public admission. */
  function publicTurnStarter() {
    const runtime: SokoBotRuntime = {
      createSession: async () => ({
        sessionId: randomUUID(),
        runtimeVersion: "test",
        acceptedAt: new Date().toISOString(),
      }),
      streamEvents: () => {
        throw new Error("This fixture stops at admission");
      },
      cancelTurn: async () => undefined,
      resetSession: async () => undefined,
      inspectSession: async () => ({
        healthy: true,
        runtimeVersion: "test",
        sessionStatus: "waiting",
      }),
    };
    return new makeControl(runtime, undefined, {
      classify: async (message) =>
        presetClassificationResult(message, {
          route: "DIRECT_RESPONSE",
          reason: "Fixture without a model call",
        }),
    });
  }

  /** Split proof stops at startTurn's shared-client reads (ticket 30). */
  function stubTurnStart(service = controlPlane) {
    const spy = vi
      .spyOn(service, "startTurn")
      .mockImplementation(async (input) => {
        if (!input.sokoBotId) throw new Error("Expected a scheduled bot");
        const turn = await prisma.sokoBotTurn.create({
          data: {
            sokoBotId: input.sokoBotId,
            workspaceId: input.workspaceId,
            requestedByUserId: input.userId,
            source: input.source ?? "SCHEDULE",
            status: "FAILED",
            clientTurnId: input.clientTurnId,
            userMessage: input.message,
            capabilityNames: [],
            deadlineAt: new Date(),
            network: input.network,
            preprodGeneration: input.expectedPreprodGeneration ?? null,
          },
        });
        return {
          turnId: turn.id,
          sokoBotId: turn.sokoBotId,
          sessionId: "fixture",
          status: "FAILED",
          errorKind: "turn_deadline_exceeded",
          route: "DIRECT_RESPONSE",
          capabilities: [],
          duplicate: true,
        };
      });
    onTestFinished(() => spy.mockRestore());
    return spy;
  }

  function capture<T>(operation: () => Promise<T>) {
    const recorder = recordStatements();
    return operation()
      .finally(recorder.restore)
      .then((result) => {
        expect(recorder.statements.flat()).not.toContain(keys()[0]);
        expect(recorder.statements.flat()).not.toContain(keys()[1]);
        return { result, count: recorder.statements.length };
      });
  }

  function retry(
    service: typeof controlPlane,
    fixture: Fixture,
    operationId = randomUUID(),
  ) {
    if (!fixture.run) throw new Error("Expected a seeded run");
    return service.performAdminAction({
      sokoBotId: fixture.bot.id,
      operatorId: fixture.userId,
      action: "RETRY_SCHEDULE_RUN",
      targetId: fixture.run.id,
      operationId,
      reason: "Test retry",
    });
  }

  it.each([null, "mainnet"] as const)(
    "keeps Mainnet pickup parity for schedule tag %s",
    async (network) => {
      await setControl("paused", "8");
      const fixture = await seed({
        network,
        ...(network ? { job: "mainnet" } : {}),
      });
      const service = publicTurnStarter();
      const start = onSplitLayout
        ? stubTurnStart()
        : vi
            .spyOn(controlPlane, "startTurn")
            .mockImplementation((input) => service.startTurn(input));
      onTestFinished(() => start.mockRestore());
      if (!onSplitLayout) await fund(fixture);
      const { result, count } = await capture(() => tick(fixture.schedule.id));
      expect(start).toHaveBeenCalledOnce();
      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({ network: "mainnet" }),
      );
      expect(count).toBe(onSplitLayout ? 21 : network === null ? 183 : 182);
      expect(result).toMatchObject({
        claimed: 1,
        ...(onSplitLayout ? { failed: 1 } : { deferred: 1 }),
      });
      expect(await scheduleOf(fixture)).toMatchObject({
        enabled: false,
        lastRunAt: fixture.schedule.nextRunAt,
        consecutiveFailures: 0,
      });
      expect(await runsOf(fixture)).toEqual([
        expect.objectContaining({
          status: onSplitLayout ? "FAILED" : "RUNNING",
          attempt: 1,
          scheduledFor: fixture.schedule.nextRunAt,
        }),
      ]);
      const turns = await prisma.sokoBotTurn.findMany({
        where: { sokoBotId: fixture.bot.id },
      });
      if (onSplitLayout)
        expect(turns).toEqual([
          expect.objectContaining({ network: "mainnet", status: "FAILED" }),
        ]);
      else
        expect(turns).toEqual([
          expect.objectContaining({
            source: "SCHEDULE",
            network: "mainnet",
            status: "RUNNING",
          }),
        ]);
      await expectNoCharges(fixture);
    },
  );

  it.each([null, "mainnet"] as const)(
    "keeps Mainnet admin retry parity for schedule tag %s",
    async (network) => {
      await setControl("paused", "8");
      const fixture = await seed({
        network,
        run: "FAILED",
        ...(network ? { job: "mainnet" } : {}),
      });
      const service = publicTurnStarter();
      if (onSplitLayout) {
        stubTurnStart(service);
      } else await fund(fixture);

      const { count } = await capture(() => retry(service, fixture));
      expect(count).toBe(onSplitLayout ? 24 : 117);
      expect(
        await prisma.sokoBotAdminAction.findMany({
          where: { sokoBotId: fixture.bot.id },
          orderBy: { createdAt: "asc" },
          select: { status: true },
        }),
      ).toEqual([{ status: "ATTEMPTED" }, { status: "SUCCEEDED" }]);
      expect(await runsOf(fixture)).toEqual([
        expect.objectContaining(
          onSplitLayout
            ? { status: "FAILED", attempt: 1 }
            : { status: "RUNNING", attempt: 2 },
        ),
      ]);
      const turns = await prisma.sokoBotTurn.findMany({
        where: { sokoBotId: fixture.bot.id },
      });
      if (onSplitLayout)
        expect(turns).toEqual([
          expect.objectContaining({ network: "mainnet", status: "FAILED" }),
        ]);
      else
        expect(turns).toEqual([
          expect.objectContaining({
            source: "ADMIN_RETRY",
            network: "mainnet",
            status: "RUNNING",
          }),
        ]);
      await expectNoCharges(fixture);
    },
  );

  it.skipIf(!onSplitLayout).each([false, true])(
    "resumes a Preprod Job with generation 7 when recovering an existing run (%s)",
    async (recover) => {
      await setControl();
      const fixture = await seed({
        network: "preprod",
        job: "both",
        ...(recover ? { run: "PENDING" } : {}),
      });
      const start = stubTurnStart();
      await expect(tick(fixture.schedule.id)).resolves.toMatchObject({
        claimed: 1,
      });
      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({
          network: "preprod",
          expectedPreprodGeneration: 7,
        }),
      );
      expect(await runsOf(fixture)).toEqual([
        expect.objectContaining({
          status: "FAILED",
          attempt: recover ? 2 : 1,
        }),
      ]);
      await expectNoCharges(fixture);
    },
  );

  it.skipIf(!onSplitLayout)(
    "refuses a Preprod Job link that resolves only in Mainnet",
    async () => {
      await setControl();
      const fixture = await seed({ network: "preprod", job: "mainnet" });
      const start = stubTurnStart();
      await expect(tick(fixture.schedule.id)).resolves.toMatchObject({
        claimed: 0,
      });
      expect(start).not.toHaveBeenCalled();
      expect(await scheduleOf(fixture)).toMatchObject({ enabled: false });
      expect(await runsOf(fixture)).toEqual([]);
      await expectNoCharges(fixture);
    },
  );

  const refusals = [
    {
      label: "off",
      pause: "open",
      generation: "7",
      status: 403,
      kind: "preprod_off",
    },
    {
      label: "paused",
      pause: "paused",
      generation: "7",
      status: 503,
      kind: "preprod_paused",
    },
    {
      label: "unavailable",
      pause: "open",
      generation: "bad",
      status: 503,
      kind: "preprod_control_unavailable",
    },
    {
      label: "stale",
      pause: "open",
      generation: "8",
      status: 409,
      kind: staleKind,
    },
  ];
  it.skipIf(!onSplitLayout).each(refusals)(
    "handles $label for due pickup, recoverable pickup and admin retry",
    async (state) => {
      const due = await seed({ network: "preprod", job: "both" });
      const recovering = await seed({
        network: "preprod",
        job: "both",
        run: "PENDING",
      });
      const admin = await seed({
        network: "preprod",
        job: "both",
        run: "FAILED",
      });
      await setControl(state.pause, state.generation);
      if (state.label === "unavailable") {
        expectCoreLog(
          "error",
          "Could not read the Preprod pause and generation",
          3,
        );
      }
      flag.on = state.label !== "off";
      onTestFinished(() => {
        flag.on = true;
      });
      const start = stubTurnStart();
      const operationId = randomUUID();
      for (const fixture of [due, recovering]) {
        await expect(tick(fixture.schedule.id)).resolves.toMatchObject({
          claimed: 0,
        });
      }
      await expect(
        retry(controlPlane, admin, operationId),
      ).rejects.toMatchObject({
        status: state.status,
        cause: { kind: state.kind },
      });
      expect(start).not.toHaveBeenCalled();
      expect(await runsOf(due)).toEqual([]);
      for (const fixture of [due, recovering, admin]) {
        if (state.status === 409) {
          expect(await scheduleOf(fixture)).toMatchObject({
            enabled: false,
            consecutiveFailures: 0,
          });
          if (fixture.run)
            expect(await runsOf(fixture)).toEqual([
              expect.objectContaining({
                status: "FAILED",
                errorKind: staleKind,
                attempt: 1,
              }),
            ]);
        } else {
          expect(await scheduleOf(fixture)).toEqual(fixture.schedule);
          if (fixture.run) expect(await runsOf(fixture)).toEqual([fixture.run]);
        }
        await expectNoCharges(fixture);
      }
      expect(
        await prisma.sokoBotAdminAction.findMany({
          where: { operationId },
          select: { status: true },
          orderBy: { createdAt: "asc" },
        }),
      ).toEqual(
        state.status === 409
          ? [{ status: "ATTEMPTED" }, { status: "FAILED" }]
          : [{ status: "ATTEMPTED" }],
      );

      flag.on = true;
      if (state.label === "paused") {
        await prisma.syncMetadata.update({
          where: { key: control.PREPROD_PAUSE_KEY },
          data: { cursorId: "open" },
        });
        await retry(controlPlane, admin, operationId);
        expect(start).toHaveBeenCalledWith(
          expect.objectContaining({
            network: "preprod",
            expectedPreprodGeneration: 7,
            source: "ADMIN_RETRY",
          }),
        );
      }
    },
  );

  it.skipIf(!onSplitLayout)(
    "passes a paused Preprod schedule and picks up the legacy Mainnet row",
    async () => {
      await setControl("paused");
      const paused = await seed({ network: "preprod", job: "both" });
      const legacy = await seed({ network: null });
      const start = stubTurnStart();
      await expect(tick()).resolves.toMatchObject({ claimed: 1 });
      expect(start).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          sokoBotId: legacy.bot.id,
          network: "mainnet",
        }),
      );
      expect(await scheduleOf(paused)).toEqual(paused.schedule);
    },
  );

  it.skipIf(!onSplitLayout).each(["pause", "raise"] as const)(
    "preserves provenance at the existing turn stamp when %s follows pickup",
    async (operation) => {
      await setControl();
      const fixture = await seed({ network: "preprod", job: "both" });
      const start = stubTurnStart();
      const admitted = start.getMockImplementation();
      if (!admitted) throw new Error("Expected the start boundary");
      const { requireScheduledTurnProvenance } = await import(
        "@/lib/soko-bot/schedule-resume"
      );
      start.mockImplementationOnce(async (input) => {
        if (operation === "raise") await control.raisePreprodGeneration();
        else
          await prisma.syncMetadata.update({
            where: { key: control.PREPROD_PAUSE_KEY },
            data: { cursorId: "paused" },
          });
        await prisma.$transaction(async (tx) => {
          const stamp = await control.networkStamp(input.network, tx);
          requireScheduledTurnProvenance(input, stamp);
        });
        return admitted(input);
      });
      await expect(tick(fixture.schedule.id)).resolves.toMatchObject({
        claimed: 1,
        ...(operation === "raise" ? { failed: 1 } : { deferred: 1 }),
      });
      expect(await runsOf(fixture)).toEqual([
        expect.objectContaining(
          operation === "raise"
            ? { status: "FAILED", errorKind: staleKind, attempt: 1 }
            : { status: "PENDING", attempt: 0, leaseToken: null },
        ),
      ]);
      expect(
        await prisma.sokoBotTurn.count({
          where: { sokoBotId: fixture.bot.id },
        }),
      ).toBe(0);
      await expectNoCharges(fixture);
    },
  );

  it.skipIf(!onSplitLayout).each(["pause", "raise"] as const)(
    "orders %s against pickup on two PostgreSQL sessions",
    async (operation) => {
      await setControl();
      const loser = await seed({ network: "preprod", job: "both" });
      const winner = await seed({ network: "preprod", job: "both" });
      const start = stubTurnStart();
      const operator = new Client({
        connectionString: process.env.DATABASE_URL,
      });
      await operator.connect();
      onTestFinished(() => operator.end());
      const schema = testSchemaNames().DATABASE_SCHEMA_SHARED;
      const update = async () => {
        await operator.query("BEGIN");
        await operator.query(
          `UPDATE "${schema}".sync_metadata SET "cursorId" = $1 WHERE "key" = $2`,
          [
            operation === "pause" ? "paused" : "open",
            control.PREPROD_PAUSE_KEY,
          ],
        );
        if (operation === "raise") {
          await operator.query(
            `UPDATE "${schema}".sync_metadata SET "cursorId" = '8' WHERE "key" = $1`,
            [control.PREPROD_GENERATION_KEY],
          );
        }
      };
      const loaded = Promise.withResolvers<void>();
      const continuePickup = Promise.withResolvers<void>();
      const findFirst = prisma.sokoBotSchedule.findFirst.bind(
        prisma.sokoBotSchedule,
      );
      const gate = vi
        .spyOn(prisma.sokoBotSchedule, "findFirst")
        .mockImplementationOnce((args) => {
          const result = (async () => {
            const schedule = await findFirst(args);
            loaded.resolve();
            await continuePickup.promise;
            return schedule;
          })();
          return result as ReturnType<typeof findFirst>;
        });
      onTestFinished(() => gate.mockRestore());

      const losingPickup = tick(loser.schedule.id);
      await loaded.promise;
      try {
        await update();
        await operator.query("COMMIT");
      } finally {
        continuePickup.resolve();
      }
      await expect(losingPickup).resolves.toMatchObject({ claimed: 0 });
      expect(await runsOf(loser)).toEqual([]);
      expect(await scheduleOf(loser)).toMatchObject({
        enabled: operation === "pause",
      });

      await operator.query(
        `UPDATE "${schema}".sync_metadata SET "cursorId" = CASE WHEN "key" = $1 THEN 'open' ELSE '7' END WHERE "key" IN ($1, $2)`,
        keys(),
      );
      await update();
      try {
        await expect(tick(winner.schedule.id)).resolves.toMatchObject({
          claimed: 1,
        });
      } finally {
        await operator.query("COMMIT");
      }
      expect(start).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          sokoBotId: winner.bot.id,
          network: "preprod",
          expectedPreprodGeneration: 7,
        }),
      );
      await expectNoCharges(loser);
      await expectNoCharges(winner);
    },
  );
});
