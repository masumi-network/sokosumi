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
import {
  AgentJobStatus,
  NotificationKind,
  TaskStatus,
} from "@sokosumi/database";
import {
  JOB_INPUT_REQUIRED_MESSAGE_KEY,
  TASK_FOLLOW_UP_MESSAGE_KEY,
  TASK_INPUT_REQUIRED_MESSAGE_KEY,
} from "@sokosumi/utils";
import type { Pool, PoolClient } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  type SendEmailInput,
  sendEmail,
  sendEmails,
} from "@/clients/email.client";
import { getEnv } from "@/config/env";
import { dispatchNotificationEmail } from "@/helpers/notification-email-dispatch";
import { findNeedsActionNotificationIds } from "@/helpers/notification-feed";

import {
  createNotification,
  publishNotificationRow,
} from "@/helpers/notifications";
import { createPersonalWorkspace } from "@/helpers/personal-workspace";
import { publishNotificationEvent } from "@/lib/ably/publish";
import { createNetworkScope, type NetworkDb } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { NETWORK_HEADER } from "@/middleware/network-scope";
import mountFollowUps from "@/routes/sync/notification-follow-ups/get";
import { onSplitLayout } from "@/test/split-layout";
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

vi.mock("@/clients/email.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/email.client")>()),
  sendEmail: vi.fn(async () => ({ id: "fixture-event-email" })),
  sendEmails: vi.fn(async (inputs: SendEmailInput[]) =>
    inputs.map((_, index) => ({ id: `fixture-follow-up-${index}` })),
  ),
}));
vi.mock("@/lib/ably/channel-occupancy", () => ({
  hasAppInFront: vi.fn().mockResolvedValue(true),
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
  let preprodDb: NetworkDb | undefined;
  const at = new Date("2026-11-27T11:00:00.000Z");
  const jobRowId = randomUUID();
  const taskRowId = randomUUID();

  beforeAll(async () => {
    app = createCoreApp();
    mountFollowUps(app);
    user = await createPasswordUser("Notification network");
    workspaceId = (await createPersonalWorkspace(user.id)).id;
    cookie = await signIn(app, user.email);
    await seedJob(mainnet.networkDb);
  }, SETUP_TIMEOUT);

  beforeEach(async () => {
    getEnv().NETWORK_PREPROD_ENABLED = false;
    await prisma.notification.deleteMany({ where: { userId: user.id } });
    vi.clearAllMocks();
  });

  afterAll(async () => {
    for (const db of [mainnet.networkDb, preprodDb]) {
      if (!db) continue;
      await db.job.deleteMany({ where: { id: jobId } });
      await db.agent.deleteMany({ where: { id: agentId } });
      await db.agentPricing.deleteMany({ where: { id: pricingId } });
    }
    if (user?.id) {
      if (workspaceId) await prisma.task.deleteMany({ where: { workspaceId } });
      await prisma.subscription.deleteMany({ where: { referenceId: user.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
    await prisma.$disconnect();
    await Promise.all(database.pools.map((pool) => pool.end()));
  }, SETUP_TIMEOUT);

  async function seedJob(db: NetworkDb) {
    await db.agent.create({
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
    await db.job.create({
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
  }

  function request(
    path: string,
    method = "GET",
    input?: object,
    network?: "mainnet" | "preprod",
  ) {
    return app.request(`${ORIGIN}/v1/notifications${path}`, {
      method,
      headers: {
        origin: ORIGIN,
        cookie,
        "content-type": "application/json",
        ...(network && { [NETWORK_HEADER]: network }),
      },
      ...(input && { body: JSON.stringify(input) }),
    });
  }

  async function data<T>(response: Response): Promise<T> {
    expect(response.status).toBe(200);
    return ((await response.json()) as { data: T }).data;
  }

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
        const response = await request(path, method, input);
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

  it("dedupes tagged writes only within their Network", async () => {
    const input = {
      userId: user.id,
      kind: NotificationKind.JOB,
      referenceId: jobId,
      eventId: "tagged-dedupe",
      messageKey: JOB_INPUT_REQUIRED_MESSAGE_KEY,
      messageParams: {},
    };
    const delivery = { inApp: false, osBanner: false, email: false };
    const first = await createNotification(
      { ...input, network: "mainnet" },
      prisma,
      delivery,
    );
    expect(first.created).toBe(true);
    expect(first.notification.network).toBe("mainnet");
    const duplicate = await createNotification(
      { ...input, network: "mainnet" },
      prisma,
      delivery,
    );
    expect(duplicate).toEqual({
      notification: first.notification,
      created: false,
    });

    const other = () =>
      createNotification({ ...input, network: "preprod" }, prisma, delivery);
    if (onSplitLayout) {
      const preprod = await other();
      expect(preprod.created).toBe(true);
      expect(preprod.notification.network).toBe("preprod");
      expect(await other()).toEqual({
        notification: preprod.notification,
        created: false,
      });
      expect(preprod.notification.id).not.toBe(first.notification.id);
      const untagged = await createNotification(input, prisma, delivery);
      expect(untagged.created).toBe(true);
      expect(await createNotification(input, prisma, delivery)).toEqual({
        notification: untagged.notification,
        created: false,
      });
      expect(
        await createNotification(
          { ...input, network: "mainnet" },
          prisma,
          delivery,
        ),
      ).toEqual({
        notification: first.notification,
        created: false,
      });
    } else {
      await expect(other()).rejects.toMatchObject({ code: "P2002" });
      expect(
        await prisma.notification.count({ where: { userId: user.id } }),
      ).toBe(1);
    }
  });

  it("reads JOB references by header and keeps TASK reads shared", async () => {
    const mainnetId = randomUUID();
    const untaggedId = randomUUID();
    const preprodId = randomUUID();
    const taskId = randomUUID();
    await prisma.notification.createMany({
      data: [
        { id: mainnetId, network: "mainnet", kind: NotificationKind.JOB },
        { id: untaggedId, network: null, kind: NotificationKind.JOB },
        { id: preprodId, network: "preprod", kind: NotificationKind.JOB },
        { id: taskId, network: null, kind: NotificationKind.TASK },
      ].map((row) => ({
        ...row,
        userId: user.id,
        referenceId: jobId,
        eventId: row.id,
        messageKey: "Notification fixture",
        messageParams: "{}",
      })),
    });

    // On the split layout the reader still has no Preprod access. The header
    // works for the shared write even when the request's Network scope refuses.
    getEnv().NETWORK_PREPROD_ENABLED = onSplitLayout;
    const job = { kind: "JOB", referenceId: jobId };
    const readIds = async () =>
      (
        await prisma.notification.findMany({
          where: { userId: user.id, isRead: true },
          select: { id: true },
        })
      )
        .map((row) => row.id)
        .sort();

    expect(await data(await request("/read", "PATCH", job))).toEqual({
      count: 2,
    });
    expect(await readIds()).toEqual([mainnetId, untaggedId].sort());

    await prisma.notification.updateMany({
      where: { userId: user.id },
      data: { isRead: false, readAt: null },
    });
    expect(await data(await request("/read", "PATCH", job, "preprod"))).toEqual(
      {
        count: onSplitLayout ? 1 : 0,
      },
    );
    expect(await readIds()).toEqual(onSplitLayout ? [preprodId] : []);
    expect(
      await data(
        await request("/read", "PATCH", { ...job, kind: "TASK" }, "preprod"),
      ),
    ).toEqual({ count: 1 });
    expect(await readIds()).toEqual(
      (onSplitLayout ? [taskId, preprodId] : [taskId]).sort(),
    );
  });

  it.runIf(onSplitLayout)(
    "looks up the same Job id in both Networks independently",
    async () => {
      getEnv().NETWORK_PREPROD_ENABLED = true;
      preprodDb = createNetworkScope("preprod").networkDb;
      await seedJob(preprodDb);
      const mainnetId = randomUUID();
      const preprodId = randomUUID();
      await prisma.notification.createMany({
        data: [
          { id: mainnetId, network: "mainnet" },
          { id: preprodId, network: "preprod" },
        ].map((row) => ({
          ...row,
          kind: NotificationKind.JOB,
          userId: user.id,
          referenceId: jobId,
          eventId: "same-event",
          messageKey: JOB_INPUT_REQUIRED_MESSAGE_KEY,
          messageParams: "{}",
        })),
      });

      async function assertNeedsAction(ids: string[]) {
        const rows = await data<{ id: string }[]>(
          await request("?needsAction=true"),
        );
        expect(rows.map((row) => row.id).sort()).toEqual(ids.sort());
        const counts = await data<{ needsAction: number }>(
          await request("/counts"),
        );
        expect(counts.needsAction).toBe(ids.length);
      }

      await assertNeedsAction([mainnetId]);
      await prisma.user.update({
        where: { id: user.id },
        data: { preprodEnabled: true },
      });
      await assertNeedsAction([mainnetId, preprodId]);
      await preprodDb.jobEvent.updateMany({
        where: { jobId },
        data: { status: AgentJobStatus.COMPLETED },
      });
      await assertNeedsAction([mainnetId]);
    },
  );

  it("hides a tagged row with Preprod off and never delivers its email", async () => {
    const task = await prisma.task.create({
      data: {
        ownerId: user.id,
        creatorUserId: user.id,
        workspaceId,
        name: "Notification fixture task",
        status: TaskStatus.INPUT_REQUIRED,
      },
    });
    const createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const row = await prisma.notification.create({
      data: {
        userId: user.id,
        kind: NotificationKind.TASK,
        network: "preprod",
        referenceId: task.id,
        eventId: "preprod-ask",
        messageKey: TASK_INPUT_REQUIRED_MESSAGE_KEY,
        messageParams: JSON.stringify({
          coworkerName: "Ada",
          taskName: task.name,
        }),
        createdAt,
      },
    });

    expect(await data(await request(""))).toEqual([]);
    expect(await data(await request("?needsAction=true"))).toEqual([]);
    expect(await data(await request("/counts"))).toEqual({
      unread: 0,
      needsAction: 0,
      mentions: 0,
    });
    // The counts and list also apply the feed filter. Call the lookup itself
    // to prove it did not return a candidate that the feed would hide anyway.
    await expect(findNeedsActionNotificationIds(user.id)).resolves.toEqual([]);
    await expect(
      publishNotificationRow(row, { inApp: true, osBanner: true, email: true }),
    ).resolves.toBe(false);
    expect(publishNotificationEvent).not.toHaveBeenCalled();
    await dispatchNotificationEmail(row);
    expect(sendEmail).not.toHaveBeenCalled();

    // The exact same source sends a reminder when tagged Mainnet, so the
    // Preprod assertion exercises an eligible source and the real sync route.
    async function runSync() {
      const response = await app.request(`${ORIGIN}/notification-follow-ups`, {
        headers: { authorization: `Bearer ${getEnv().CRON_SECRET}` },
      });
      expect(response.status).toBe(200);
      expect(await drainWaitUntil()).toEqual([]);
    }
    await runSync();
    expect(sendEmails).not.toHaveBeenCalled();
    if (onSplitLayout) {
      getEnv().NETWORK_PREPROD_ENABLED = true;
      await dispatchNotificationEmail(row);
      await runSync();
      expect(sendEmail).not.toHaveBeenCalled();
      expect(sendEmails).not.toHaveBeenCalled();
    }
    expect(
      await prisma.notification.count({
        where: { userId: user.id, messageKey: TASK_FOLLOW_UP_MESSAGE_KEY },
      }),
    ).toBe(0);

    await prisma.notification.update({
      where: { id: row.id },
      data: { network: "mainnet" },
    });
    await runSync();
    expect(sendEmails).toHaveBeenCalledOnce();
    expect(
      await prisma.notification.count({
        where: { userId: user.id, messageKey: TASK_FOLLOW_UP_MESSAGE_KEY },
      }),
    ).toBe(1);
  });

  it("suppresses event emails only for an earlier unread email on the same Network", async () => {
    const base = {
      userId: user.id,
      kind: NotificationKind.TASK,
      referenceId: randomUUID(),
      messageKey: "Notifications.Task.completed",
      messageParams: JSON.stringify({
        coworkerName: "Ada",
        taskName: "Fixture task",
      }),
    };
    await prisma.notification.create({
      data: {
        ...base,
        eventId: "previous",
        network: "preprod",
        emailId: "previous-preprod-email",
      },
    });
    const main = await prisma.notification.create({
      data: { ...base, eventId: "main", network: "mainnet" },
    });
    await dispatchNotificationEmail(main);
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledAt: expect.any(String),
        to: user.email,
      }),
    );
    const duplicate = await prisma.notification.create({
      data: { ...base, eventId: "next", network: "mainnet" },
    });
    await dispatchNotificationEmail(duplicate);
    expect(sendEmail).toHaveBeenCalledOnce();
  });
});
