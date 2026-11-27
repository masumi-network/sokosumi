/**
 * `GET /v1/notifications` names each row's Network on a real PostgreSQL, with
 * a real session: an old JOB row that ticket 07 tagged answers its Network,
 * and a row without one answers null.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/routes/v1/notifications/get.postgres.test.ts
 */
// First: schemas built before this module loads have no `.openapi`, and the
// `/v1` router needs it on the ones `@sokosumi/utils` exports.
import "@hono/zod-openapi";

import { randomUUID } from "node:crypto";
import { AgentJobStatus, NotificationKind } from "@sokosumi/database";
import { JOB_INPUT_REQUIRED_MESSAGE_KEY } from "@sokosumi/utils";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createNotification } from "@/helpers/notifications";
import { createPersonalWorkspace } from "@/helpers/personal-workspace";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { drainWaitUntil } from "@/test/wait-until";
import {
  createCoreApp,
  createPasswordUser,
  ORIGIN,
  signIn,
} from "@/test-fixtures/core-session";

const database = vi.hoisted(() => ({ pools: [] as Pool[], statements: 0 }));
vi.mock("@vercel/functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/functions")>();
  return {
    ...actual,
    waitUntil: vi.fn(),
    attachDatabasePool: (pool: Pool) => {
      database.pools.push(pool);
      pool.on("connect", (client: PoolClient) => {
        const query = client.query.bind(client) as (
          ...args: unknown[]
        ) => unknown;
        (client as { query: unknown }).query = (...args: unknown[]) => {
          database.statements++;
          return query(...args);
        };
      });
      actual.attachDatabasePool(pool);
    },
  };
});
vi.mock("@/lib/ably/publish", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ably/publish")>()),
  publishNotificationEvent: vi.fn(),
}));

vi.mock("@/helpers/background-email", () => ({
  sendEmailInBackground: vi.fn(),
}));
vi.mock("@/clients/stripe.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/clients/stripe.client")>();
  return {
    ...actual,
    stripeClient: {
      ...actual.stripeClient,
      createUserCustomer: vi.fn().mockResolvedValue({}),
    },
  };
});
vi.mock("@/services/webhook.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/webhook.service")>();
  return {
    ...actual,
    webhookService: {
      ...actual.webhookService,
      callAccountCreated: vi.fn().mockResolvedValue(undefined),
      callUserWebhook: vi.fn().mockResolvedValue(undefined),
    },
  };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

/** The setup signs in through Core's whole app, past CI's 10 s hook limit. */
const SETUP_TIMEOUT = 60_000;

describe.skipIf(!enabled)("GET /v1/notifications network", () => {
  let app: ReturnType<typeof createCoreApp>;
  let user: Awaited<ReturnType<typeof createPasswordUser>>;
  let cookie: string;
  let workspaceId: string;
  const jobId = randomUUID();
  const agentId = randomUUID();
  const pricingId = randomUUID();
  const mainnet = createNetworkScope("mainnet");
  const at = new Date("2026-11-27T11:00:00.000Z");
  const jobRowId = randomUUID();
  const taskRowId = randomUUID();

  beforeAll(async () => {
    app = createCoreApp();
    user = await createPasswordUser("Notification network");
    workspaceId = (await createPersonalWorkspace(user.id)).id;
    cookie = await signIn(app, user.email);
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    await mainnet.networkDb.job.deleteMany({ where: { id: jobId } });
    await mainnet.networkDb.agent.deleteMany({ where: { id: agentId } });
    await mainnet.networkDb.agentPricing.deleteMany({
      where: { id: pricingId },
    });
    if (user?.id) {
      await prisma.subscription.deleteMany({ where: { referenceId: user.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
    await prisma.$disconnect();
    await Promise.all(database.pools.map((pool) => pool.end()));
  }, SETUP_TIMEOUT);

  it("answers the Network of a tagged JOB row and null for a row without", async () => {
    await prisma.notification.createMany({
      data: [
        {
          id: jobRowId,
          userId: user.id,
          kind: NotificationKind.JOB,
          referenceId: randomUUID(),
          eventId: "event-job",
          messageKey: "Notifications.Job.completed",
          messageParams: "{}",
          network: "mainnet",
        },
        {
          id: taskRowId,
          userId: user.id,
          kind: NotificationKind.TASK,
          referenceId: randomUUID(),
          eventId: "event-task",
          messageKey: "Notifications.Task.completed",
          messageParams: "{}",
        },
      ],
    });
    const response = await app.request(`${ORIGIN}/v1/notifications`, {
      headers: { origin: ORIGIN, cookie },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { id: string; network: unknown }[];
    };
    expect(
      Object.fromEntries(body.data.map((item) => [item.id, item.network])),
    ).toEqual({ [jobRowId]: "mainnet", [taskRowId]: null });
  });

  it("keeps the untagged create and duplicate on the same row and statement budget", async () => {
    const input = {
      userId: user.id,
      kind: NotificationKind.TASK,
      referenceId: randomUUID(),
      eventId: "dedupe-event",
      messageKey: "Notifications.Task.completed",
      messageParams: { taskName: "Original" },
    };
    const delivery = { inApp: false, osBanner: false, email: false };
    const before = database.statements;
    const original = await createNotification(input, prisma, delivery);
    const afterCreate = database.statements;
    const duplicate = await createNotification(
      { ...input, messageParams: { taskName: "Changed" } },
      prisma,
      delivery,
    );
    expect(original.created).toBe(true);
    expect(duplicate).toEqual({
      notification: original.notification,
      created: false,
    });
    expect({
      create: afterCreate - before,
      duplicate: database.statements - afterCreate,
    }).toMatchSnapshot();
    await prisma.notification.delete({
      where: { id: original.notification.id },
    });
  });

  // Snapshot recorded on origin/main at 9a7b4787f. Both runs use the same
  // requests, fixture data and counter attached to Core's pg pool.
  it(
    "preserves Mainnet bodies and statement counts for untagged rows",
    async () => {
      await prisma.notification.deleteMany({ where: { userId: user.id } });
      await mainnet.networkDb.agent.create({
        data: {
          id: agentId,
          blockchainIdentifier: agentId,
          name: "Notification fixture agent",
          lastUptimeCheck: at,
          uptimeCount: 0,
          uptimeCheckCount: 0,
          isShown: false,
          pricing: { create: { id: pricingId, pricingType: "FREE" } },
        },
      });
      await mainnet.networkDb.job.create({
        data: {
          id: jobId,
          ownerId: user.id,
          workspaceId,
          agentId,
          agentJobId: jobId,
          jobType: "FREE",
          events: { create: { status: AgentJobStatus.AWAITING_INPUT } },
        },
      });
      const job = {
        id: jobRowId,
        userId: user.id,
        kind: NotificationKind.JOB,
        referenceId: jobId,
        eventId: "job-event",
        messageKey: JOB_INPUT_REQUIRED_MESSAGE_KEY,
        messageParams: "{}",
        createdAt: at,
      };
      const taskReferenceId = "untagged-task";
      const task = {
        ...job,
        id: taskRowId,
        kind: NotificationKind.TASK,
        referenceId: taskReferenceId,
        eventId: "task-event",
        messageKey: "Notifications.Task.completed",
        createdAt: new Date(at.getTime() + 1),
      };
      await prisma.notification.createMany({ data: [job, task] });

      async function call(path: string, method = "GET", input?: object) {
        const before = database.statements;
        const response = await app.request(
          `${ORIGIN}/v1/notifications${path}`,
          {
            method,
            headers: {
              origin: ORIGIN,
              cookie,
              "content-type": "application/json",
            },
            ...(input && { body: JSON.stringify(input) }),
          },
        );
        expect(await drainWaitUntil()).toEqual([]);
        expect(response.status).toBe(200);
        const statements = database.statements - before;
        const body = (await response.json()) as {
          meta: Record<string, unknown>;
        };
        delete body.meta.timestamp;
        delete body.meta.requestId;
        const normalized = JSON.stringify(body)
          .replaceAll(user.id, "fixture-user")
          .replaceAll(jobRowId, "job-notification")
          .replaceAll(taskRowId, "task-notification")
          .replaceAll(jobId, "fixture-job")
          .replace(/"readAt":"[^"]+"/g, '"readAt":"set"');
        return { statements, body: JSON.parse(normalized) as unknown };
      }

      await call(""); // Warm the session reader before counting.
      expect({
        list: await call(""),
        paged: await call(`?limit=1&cursor=${taskRowId}`),
        needsAction: await call("?needsAction=true"),
        counts: await call("/counts"),
        readJob: await call("/read", "PATCH", {
          kind: "JOB",
          referenceId: jobId,
        }),
        readTask: await call("/read", "PATCH", {
          kind: "TASK",
          referenceId: taskReferenceId,
        }),
        unreadById: await call(`/${jobRowId}/unread`, "PATCH"),
        readById: await call(`/${jobRowId}/read`, "PATCH"),
        unreadAgain: await call(`/${jobRowId}/unread`, "PATCH"),
        readByIds: await call("/read", "PATCH", { ids: [jobRowId] }),
        unreadForReadAll: await call(`/${taskRowId}/unread`, "PATCH"),
        readAll: await call("/read-all", "PATCH"),
      }).toMatchSnapshot();
    },
    SETUP_TIMEOUT,
  );
});
