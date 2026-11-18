/**
 * A sandbox's failure report racing a cancellation, against a disposable
 * PostgreSQL database and the real reconciler. The report passed
 * authorization before the cancellation commits; the owner's cancellation
 * settles CANCELLED, deadline cleanup keeps the failure.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/services/soko-bot-sandbox-turn-cancellation.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import type { RuntimeCancelInput, SokoBotRuntime } from "@sokosumi/soko-bot";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";

vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);

const background = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  waitUntil: vi.fn((work: Promise<unknown>) => {
    background.push(work);
  }),
}));

// `afterAuthorized` runs once the report passed authorization, before it
// appends; `afterCancelled` once a runtime cancel appended turn.cancelled,
// before its session.waiting.
const hooks = vi.hoisted(() => ({
  afterAuthorized: undefined as (() => Promise<void>) | undefined,
  afterCancelled: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("@/services/soko-bot-runtime.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/soko-bot-runtime.service")
  >()),
  sokoBotRuntimeService: {
    authorize: async () => {
      const pause = hooks.afterAuthorized;
      hooks.afterAuthorized = undefined;
      await pause?.();
    },
  },
}));
vi.mock("@/lib/soko-bot/sandbox/sandbox-runtime", () => ({
  stopTurnSandbox: vi.fn(),
}));
// The sandbox runtime's cancel and event stream, without a VM to stop.
vi.mock("@/services/soko-bot-control-plane.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/soko-bot-control-plane.service")
    >();
  const stored = await import("@/lib/soko-bot/in-process-runtime");
  const { RuntimeEventLog, runtimeEvent } = await import(
    "@/lib/soko-bot/turn-loop"
  );
  const runtime: SokoBotRuntime = {
    createSession: async () => {
      throw new Error("not used");
    },
    streamEvents: stored.streamStoredEvents,
    cancelTurn: async (input: RuntimeCancelInput) => {
      await stored.cancelStoredTurn(input);
      const pause = hooks.afterCancelled;
      hooks.afterCancelled = undefined;
      await pause?.();
      const turn = await prisma.sokoBotTurn.findFirstOrThrow({
        where: { eveSessionId: input.sessionId },
        select: { id: true },
      });
      await new RuntimeEventLog(turn.id, input.sessionId).append(
        runtimeEvent("session.waiting", {}),
      );
    },
    resetSession: stored.resetStoredSession,
    inspectSession: async () => ({
      healthy: true,
      runtimeVersion: "test",
      sessionStatus: "waiting",
    }),
  };
  return {
    ...actual,
    sokoBotControlPlane: new actual.SokoBotControlPlane(runtime),
  };
});

import { RuntimeEventLog, runtimeEvent } from "@/lib/soko-bot/turn-loop";
import { coreLogEvents } from "@/test/core-log";
import { sokoBotControlPlane } from "./soko-bot-control-plane.service";
import { failSandboxTurn } from "./soko-bot-sandbox-turn.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const HOUR = 60 * 60 * 1_000;
const died = { code: "runner_exited", message: "exit code 1" };

describe.skipIf(!enabled)(
  "a sandbox failure report racing a cancellation",
  () => {
    let userId: string;
    let turnId: string;
    let sessionId: string;

    beforeEach(async () => {
      // The id comes first, so teardown can find whatever setup wrote.
      userId = randomUUID();
      sessionId = `sess_${randomUUID()}`;
      await prisma.user.create({
        data: {
          id: userId,
          name: "Cancellation owner",
          email: `${userId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const workspaceId = (await prisma.workspace.create({ data: { userId } }))
        .id;
      const botId = (
        await prisma.sokoBot.create({ data: { userId, workspaceId } })
      ).id;
      turnId = (
        await prisma.sokoBotTurn.create({
          data: {
            sokoBotId: botId,
            requestedByUserId: userId,
            workspaceId,
            source: "CHAT",
            status: "RUNNING",
            clientTurnId: randomUUID(),
            userMessage: "Fixture turn",
            capabilityNames: [],
            eveSessionId: sessionId,
            eveTurnId: "eve_turn",
            leaseToken: "lease",
            leaseExpiresAt: new Date(Date.now() + HOUR),
            deadlineAt: new Date(Date.now() + HOUR),
            startedAt: new Date(),
          },
        })
      ).id;
      await new RuntimeEventLog(turnId, sessionId).append(
        runtimeEvent("turn.started", { turnId: "eve_turn" }),
      );
    });

    afterEach(async () => {
      hooks.afterAuthorized = undefined;
      hooks.afterCancelled = undefined;
      while (background.length > 0)
        await Promise.allSettled(background.splice(0));
      // The cascade from the user takes its workspace, bot, turn and events.
      await prisma.user.deleteMany({ where: { id: userId } });
    });
    afterAll(async () => {
      await prisma.$disconnect();
    });

    const report = () =>
      failSandboxTurn(
        {
          turnId,
          sessionId,
          expiresAt: Date.now() + HOUR,
          reconciliationLeaseToken: "lease",
        },
        died,
      );
    const settled = () =>
      prisma.sokoBotTurn.findUniqueOrThrow({
        where: { id: turnId },
        select: { status: true, errorKind: true },
      });
    const failures = () =>
      prisma.sokoBotRuntimeEvent.count({
        where: { turnId, type: "turn.failed" },
      });
    // The owner's cancel route writes the row this way before it cancels at
    // the runtime.
    const requestCancellation = (client: Pick<typeof prisma, "sokoBotTurn">) =>
      client.sokoBotTurn.updateMany({
        where: { id: turnId, status: { in: ["STARTING", "RUNNING"] } },
        data: {
          status: "CANCEL_REQUESTED",
          cancellationRequestedAt: new Date(),
        },
      });

    it("runtime close leaves an admin reset's replacement lease alone", async () => {
      const resetToken = randomUUID();
      hooks.afterAuthorized = async () => {
        await requestCancellation(prisma);
        await prisma.sokoBotTurn.update({
          where: { id: turnId },
          data: {
            leaseToken: resetToken,
            reconcilerHeartbeatAt: await databaseNow(),
          },
        });
      };

      await report();

      expect(await failures()).toBe(0);
      expect(
        await prisma.sokoBotTurn.findUniqueOrThrow({ where: { id: turnId } }),
      ).toMatchObject({ status: "CANCEL_REQUESTED", leaseToken: resetToken });
      expect(coreLogEvents()).toContainEqual(
        expect.objectContaining({
          level: "info",
          operation: "soko_bot_turn_reconcile",
          turn: { id: turnId },
          outcome: "lease_lost",
        }),
      );
    });

    it("settles CANCELLED when only the owner's row update committed", async () => {
      hooks.afterAuthorized = async () => {
        await requestCancellation(prisma);
      };

      await report();

      expect(await failures()).toBe(0);
      expect((await settled()).status).toBe("CANCELLED");
    });

    it("settles CANCELLED when the owner's cancellation also reached the runtime", async () => {
      hooks.afterAuthorized = () =>
        sokoBotControlPlane.cancelTurn(userId, turnId);

      await report();

      expect(await failures()).toBe(0);
      expect((await settled()).status).toBe("CANCELLED");
    });

    it("settles CANCELLED when the report waits on a cancellation still committing", async () => {
      const holding = Promise.withResolvers<number>();
      const release = Promise.withResolvers<void>();
      const cancellation = prisma.$transaction(async (tx) => {
        await requestCancellation(tx);
        const [{ pid }] = await tx.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        holding.resolve(pid);
        await release.promise;
      });
      const holder = await holding.promise;
      let reported = false;
      const failing = report().finally(() => {
        reported = true;
      });
      // The report's row write blocks on the uncommitted cancellation.
      let blocked = false;
      while (!blocked && !reported) {
        const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE ${holder}::int = ANY(pg_blocking_pids(pid))
      `;
        blocked = waiting > 0;
      }
      release.resolve();
      await cancellation;
      await failing;

      expect(blocked).toBe(true);
      expect(await failures()).toBe(0);
      expect((await settled()).status).toBe("CANCELLED");
    });

    it("keeps the failure when the report commits before the owner cancels", async () => {
      await report();
      await sokoBotControlPlane.cancelTurn(userId, turnId);

      expect(await settled()).toEqual({
        status: "FAILED",
        errorKind: "runner_exited",
      });
    });

    it("keeps the failure when deadline cleanup cancels at the runtime meanwhile", async () => {
      // The watchdog pauses between its turn.cancelled and its session.waiting
      // while the report runs; the row records no owner's cancellation.
      const cancelled = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      hooks.afterCancelled = async () => {
        cancelled.resolve();
        await resume.promise;
      };
      let expiry: Promise<boolean> | undefined;
      hooks.afterAuthorized = async () => {
        expiry = sokoBotControlPlane.expireTurn(turnId);
        await cancelled.promise;
      };

      await report();
      resume.resolve();
      await expiry;

      expect(await failures()).toBe(1);
      expect((await settled()).status).toBe("FAILED");
    });

    it("fails a live turn", async () => {
      await report();

      expect(await settled()).toEqual({
        status: "FAILED",
        errorKind: "runner_exited",
      });
    });
  },
);
