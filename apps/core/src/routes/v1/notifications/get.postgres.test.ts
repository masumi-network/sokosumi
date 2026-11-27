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
import { NotificationKind } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";
import {
  createCoreApp,
  createPasswordUser,
  ORIGIN,
  signIn,
} from "@/test-fixtures/core-session";

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
  const jobRowId = randomUUID();
  const taskRowId = randomUUID();

  beforeAll(async () => {
    app = createCoreApp();
    user = await createPasswordUser("Notification network");
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
    cookie = await signIn(app, user.email);
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.$disconnect();
  }, SETUP_TIMEOUT);

  it("answers the Network of a tagged JOB row and null for a row without", async () => {
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
});
