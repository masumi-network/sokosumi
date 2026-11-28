/**
 * Coworker usage on the Network the call names, with Preprod on, on a real
 * PostgreSQL with all three schemas (`POST /me/usage`): Preprod records the
 * usage at its price and takes no credits, keeps Mainnet's Seat rule and asks
 * the billed party's flag; a replay answers from the Network the call names;
 * a key used on the other Network is a final conflict, also for two first
 * uses at once. Runs on the split layout only: on today's layout Preprod's
 * schema is Mainnet's. Mainnet's answers, rows and statements are compared
 * with `origin/main` in `post-spend.postgres.test.ts`.
 * SPLIT_LAYOUT_RUN=must-pass RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=… DATABASE_SCHEMA_*=… pnpm --filter core test src/routes/v1/coworkers/me/usage/post-network.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { onSplitLayout } from "@/test/split-layout";

// Before any import reads the environment: Preprod is on in this run only.
await vi.hoisted(async () => {
  const { isSplitLayout } = await import("@/test/split-layout-pending");
  vi.stubEnv(
    "NETWORK_PREPROD_ENABLED",
    isSplitLayout(process.env) ? "true" : "false",
  );
});

/** What a request reaches outside the database, and its background work. */
const outside = vi.hoisted(() => ({
  background: [] as Promise<unknown>[],
  email: vi.fn(async () => undefined),
  publish: vi.fn(),
  dispatchEmail: vi.fn(async () => undefined),
}));
vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  // Kept, so the low-balance alert the route schedules can be awaited.
  waitUntil: (promise: Promise<unknown>) => {
    outside.background.push(promise);
  },
}));
vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});
// The alert runs for real; only what it sends outside is stubbed.
vi.mock("@/helpers/billing-notification-email", () => ({
  sendBillingNotificationEmail: outside.email,
}));
vi.mock("@/helpers/notification-publish-queue", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/helpers/notification-publish-queue")
  >()),
  scheduleNotificationPublish: outside.publish,
}));
vi.mock("@/helpers/notification-email-dispatch", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/helpers/notification-email-dispatch")
  >()),
  dispatchNotificationEmail: outside.dispatchEmail,
}));

import {
  NotificationKind,
  VendorGrantStatus,
  VendorPermission,
} from "@sokosumi/database";
import {
  creditBucketRepository,
  workspaceRepository,
} from "@sokosumi/database/repositories";
import { convertCreditsToCents } from "@sokosumi/utils";

import { errorHandler } from "@/helpers/error-handler";
import { createPersonalWorkspace } from "@/helpers/personal-workspace";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { Network } from "@/lib/network";
import { NETWORK_HEADER } from "@/middleware/network-scope";

import mountPostCoworkerMeUsage from "./post";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres")) &&
  onSplitLayout;

/** Workspaces through the product's own path: past 10 s on CI's runner. */
const SETUP_TIMEOUT = 60_000;
const CASE_TIMEOUT = 60_000;
const DAY = 86_400_000;
const NETWORKS = ["mainnet", "preprod"] as const satisfies Network[];

const vendorId = randomUUID();
const coworkerId = randomUUID();
const userIds: string[] = [];
const organizationIds: string[] = [];

const networkDb = (network: Network) => createNetworkScope(network).networkDb;

interface Payer {
  userId: string;
  organizationId: string | null;
  /** Who reads the wallet's billing notices. */
  recipients: string[];
}

async function createUser(
  data: { preprodEnabled?: boolean; role?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      name: "Usage Network fixture",
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    },
  });
  userIds.push(id);
  return id;
}

/** Credits on Mainnet in one bucket. Preprod's wallet stays empty. */
async function grantMainnet(
  owner: { userId: string } | { organizationId: string },
  credits: number,
) {
  const cents = convertCreditsToCents(credits);
  await networkDb("mainnet").transaction.create({
    data: {
      amount: cents,
      ...owner,
      sourceCreditBucket: {
        create: {
          amount: cents,
          ...owner,
          expiresAt: new Date(Date.now() + 10 * DAY),
        },
      },
    },
  });
}

async function grantWorkspace(workspaceId: string) {
  await prisma.vendorGrant.create({
    data: {
      vendorId,
      workspaceId,
      permission: VendorPermission.workspace,
      status: VendorGrantStatus.GRANTED,
    },
  });
}

/** A person whose personal workspace is granted to the Coworker's vendor. */
async function person(
  mainnetCredits: number,
  user: { preprodEnabled?: boolean; role?: string } = {},
): Promise<Payer> {
  const userId = await createUser(user);
  const workspace = await createPersonalWorkspace(userId);
  // The sign-up grants are other writers': the fixture's own bucket decides.
  for (const network of NETWORKS) {
    await networkDb(network).creditBucket.deleteMany({ where: { userId } });
    await networkDb(network).transaction.deleteMany({ where: { userId } });
  }
  if (mainnetCredits > 0) await grantMainnet({ userId }, mainnetCredits);
  await grantWorkspace(workspace.id);
  return { userId, organizationId: null, recipients: [userId] };
}

/**
 * A member with no assigned Seat in an Organization on a paid plan that has
 * Preprod access and 50 Mainnet credits, its workspace granted to the vendor.
 */
async function unseatedMember(): Promise<Payer> {
  const ownerId = await createUser();
  const memberId = await createUser({ preprodEnabled: true });
  const organizationId = `usage-network-${randomUUID()}`;
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "Usage Network fixture",
      slug: organizationId,
      preprodEnabled: true,
      members: {
        create: [
          { userId: ownerId, role: "owner", seatAssignedAt: new Date() },
          { userId: memberId, role: "member", seatAssignedAt: null },
        ],
      },
    },
  });
  organizationIds.push(organizationId);
  await prisma.subscription.create({
    data: {
      plan: "standard",
      referenceId: organizationId,
      status: "active",
      seats: 2,
      periodStart: new Date(Date.now() - DAY),
      periodEnd: new Date(Date.now() + 30 * DAY),
    },
  });
  const workspace = await workspaceRepository.upsertOrganizationWorkspace({
    organizationId,
    tx: prisma,
  });
  await grantMainnet({ organizationId }, 50);
  await grantWorkspace(workspace.id);
  return { userId: memberId, organizationId, recipients: [ownerId] };
}

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "coworker-usage-network");
    c.set("isAuthenticated", true);
    c.set("authContext", { actor: "coworker", coworkerId, vendorId });
    await next();
  });
  app.onError(errorHandler);
  mountPostCoworkerMeUsage(app);
  return app;
}

interface Answer {
  status: number;
  body: {
    data?: Record<string, unknown>;
    kind?: string;
    message?: string;
    meta?: Record<string, unknown>;
  };
}

/** One usage on the named Network (no header: Mainnet), its alert awaited. */
async function postUsage(
  network: Network | undefined,
  payer: Payer,
  usage: { idempotencyKey: string; credits: number },
): Promise<Answer> {
  const response = await createApp().request("http://localhost/me/usage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(network && { [NETWORK_HEADER]: network }),
    },
    body: JSON.stringify({
      ...usage,
      userId: payer.userId,
      organizationId: payer.organizationId,
    }),
  });
  const answer = { status: response.status, body: await response.json() };
  while (outside.background.length > 0) {
    await Promise.allSettled(outside.background.splice(0));
  }
  return answer;
}

/** Every credit and usage row of the payer's wallet on one Network. */
async function rows(network: Network, payer: Payer) {
  const db = networkDb(network);
  const wallet = payer.organizationId
    ? { organizationId: payer.organizationId }
    : { userId: payer.userId, organizationId: null };
  return {
    transactions: await db.transaction.findMany({
      where: wallet,
      orderBy: { id: "asc" },
      select: { id: true, amount: true },
    }),
    buckets: await db.creditBucket.findMany({
      where: wallet,
      orderBy: { id: "asc" },
      select: { id: true, amount: true },
    }),
    consumptions: await db.creditConsumption.findMany({
      where: { transaction: wallet },
      orderBy: { id: "asc" },
      select: { amount: true, bucketId: true, transactionId: true },
    }),
    usage: await db.coworkerUsage.findMany({
      where: { coworkerId, userId: payer.userId },
      orderBy: { id: "asc" },
    }),
  };
}

const billingNotices = (payer: Payer) =>
  prisma.notification.count({
    where: { userId: { in: payer.recipients }, kind: NotificationKind.BILLING },
  });

/** The id of the transaction that wrote a row: PostgreSQL's `xmin`. */
async function writerOf(
  network: Network,
  table: "coworker_usage" | "Transaction",
  id: string,
): Promise<string> {
  const scope = createNetworkScope(network);
  const [row] = await scope.networkDb.$queryRaw<{ xmin: string }[]>`
    SELECT xmin::text AS xmin FROM ${scope.networkTable(table)} WHERE id = ${id}
  `;
  if (!row) throw new Error(`No ${table} row ${id} on ${network}`);
  return row.xmin;
}

const key = () => `usage-network-${randomUUID()}`;
const other = (network: Network): Network =>
  network === "mainnet" ? "preprod" : "mainnet";
const CREDITS = 2.5;
const CENTS = convertCreditsToCents(CREDITS);

describe.runIf(enabled)(
  "Coworker usage on the Network the call names, Preprod on (PostgreSQL, split layout)",
  () => {
    beforeAll(async () => {
      await prisma.vendor.create({
        data: {
          id: vendorId,
          name: "Usage Network vendor",
          slug: `usage-network-${vendorId}`,
          coworkers: {
            create: {
              id: coworkerId,
              slug: `usage-network-${coworkerId}`,
              name: "Usage Network coworker",
              capabilities: ["tasks"],
            },
          },
        },
      });
    }, SETUP_TIMEOUT);

    afterEach(() => {
      vi.restoreAllMocks();
      outside.email.mockClear();
    });

    afterAll(async () => {
      const wallets = {
        OR: [
          { userId: { in: userIds } },
          { organizationId: { in: organizationIds } },
        ],
      };
      for (const network of NETWORKS) {
        const db = networkDb(network);
        await db.coworkerUsage.deleteMany({ where: { coworkerId } });
        await db.creditConsumption.deleteMany({
          where: { transaction: wallets },
        });
        await db.creditBucket.deleteMany({ where: wallets });
        await db.transaction.deleteMany({ where: wallets });
      }
      await prisma.notification.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.vendorGrant.deleteMany({ where: { vendorId } });
      await prisma.coworker.deleteMany({ where: { id: coworkerId } });
      await prisma.vendor.deleteMany({ where: { id: vendorId } });
      await prisma.workspace.deleteMany({
        where: { organizationId: { in: organizationIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      await prisma.subscription.deleteMany({
        where: { referenceId: { in: [...userIds, ...organizationIds] } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      vi.unstubAllEnvs();
    }, SETUP_TIMEOUT);

    it(
      "records a Preprod usage at its price with an empty Preprod wallet, takes no credits and sends no notice; Mainnet charges as before",
      async () => {
        // One Mainnet credit, below the low-balance threshold: a notice for
        // this wallet would be sent if anything checked Mainnet's.
        const payer = await person(1, { preprodEnabled: true });
        const mainnetBefore = await rows("mainnet", payer);

        const answer = await postUsage("preprod", payer, {
          idempotencyKey: key(),
          credits: CREDITS,
        });

        expect(answer.status, JSON.stringify(answer.body)).toBe(201);
        const preprod = await rows("preprod", payer);
        expect(preprod.transactions).toEqual([
          { id: answer.body.data?.transactionId, amount: -CENTS },
        ]);
        expect(preprod.usage).toMatchObject([
          {
            id: answer.body.data?.id,
            cents: CENTS,
            transactionId: answer.body.data?.transactionId,
          },
        ]);
        expect(preprod.buckets).toEqual([]);
        expect(preprod.consumptions).toEqual([]);
        // The usage row and its debit: one transaction.
        const [usage] = preprod.usage;
        if (!usage) throw new Error("No Preprod usage");
        expect(await writerOf("preprod", "coworker_usage", usage.id)).toBe(
          await writerOf("preprod", "Transaction", usage.transactionId),
        );
        expect(await rows("mainnet", payer)).toEqual(mainnetBefore);
        expect(await billingNotices(payer)).toBe(0);
        expect(outside.email).not.toHaveBeenCalled();

        // The same call on Mainnet, by a funded payer: charged, as before.
        const funded = await person(200, { preprodEnabled: true });
        const mainnet = await postUsage(undefined, funded, {
          idempotencyKey: key(),
          credits: CREDITS,
        });
        expect(mainnet.status).toBe(201);
        const charged = await rows("mainnet", funded);
        expect(charged.consumptions).toEqual([
          {
            amount: CENTS,
            bucketId: charged.buckets[0]?.id,
            transactionId: mainnet.body.data?.transactionId,
          },
        ]);
        expect(charged.usage).toHaveLength(1);
        expect(await rows("preprod", funded)).toMatchObject({
          transactions: [],
          usage: [],
        });
        // The response keeps its shape: no Network field.
        expect(Object.keys(answer.body.data ?? {}).sort()).toEqual(
          Object.keys(mainnet.body.data ?? {}).sort(),
        );
      },
      CASE_TIMEOUT,
    );

    it(
      "refuses a member without a Seat in a paid Organization on Preprod with Mainnet's 403, and writes nothing",
      async () => {
        const payer = await unseatedMember();
        const spent = vi.spyOn(creditBucketRepository, "recordSpend");
        const answers: Answer[] = [];
        for (const network of ["preprod", "mainnet"] as const) {
          answers.push(
            await postUsage(network, payer, {
              idempotencyKey: key(),
              credits: CREDITS,
            }),
          );
        }

        const [preprod, mainnet] = answers.map(({ status, body }) => ({
          status,
          body: { ...body, meta: { ...body.meta, timestamp: undefined } },
        }));
        expect(preprod).toMatchObject({
          status: 403,
          body: { kind: "organization_seat_required" },
        });
        expect(preprod).toEqual(mainnet);
        expect(spent).not.toHaveBeenCalled();
        for (const network of NETWORKS) {
          const left = await rows(network, payer);
          expect(left.usage).toEqual([]);
          expect(left.consumptions).toEqual([]);
        }
      },
      CASE_TIMEOUT,
    );

    for (const role of ["user", "admin"] as const) {
      it(
        `refuses a billed ${role} without the Preprod flag before any write: no admin shortcut`,
        async () => {
          const payer = await person(200, { preprodEnabled: false, role });
          const before = await rows("mainnet", payer);
          const spent = vi.spyOn(creditBucketRepository, "recordSpend");

          const answer = await postUsage("preprod", payer, {
            idempotencyKey: key(),
            credits: CREDITS,
          });

          expect(answer).toMatchObject({
            status: 403,
            body: { kind: "preprod_access_required" },
          });
          expect(spent).not.toHaveBeenCalled();
          expect(await rows("preprod", payer)).toMatchObject({
            transactions: [],
            usage: [],
          });
          expect(await rows("mainnet", payer)).toEqual(before);
        },
        CASE_TIMEOUT,
      );
    }

    it(
      "replays a Preprod usage with Preprod's row, also after the billed party lost its flag",
      async () => {
        const payer = await person(200, { preprodEnabled: true });
        const usage = { idempotencyKey: key(), credits: CREDITS };
        const fresh = await postUsage("preprod", payer, usage);
        expect(fresh.status).toBe(201);
        const replay = await postUsage("preprod", payer, usage);
        await prisma.user.update({
          where: { id: payer.userId },
          data: { preprodEnabled: false },
        });
        const afterRevocation = await postUsage("preprod", payer, usage);

        for (const answer of [replay, afterRevocation]) {
          expect(answer.status).toBe(200);
          expect(answer.body.data).toEqual(fresh.body.data);
        }
        expect((await rows("preprod", payer)).usage).toHaveLength(1);
        expect(await rows("mainnet", payer)).toMatchObject({ usage: [] });
      },
      CASE_TIMEOUT,
    );

    for (const first of NETWORKS) {
      it(
        `refuses a key used on ${first} when the call names ${other(first)}, and writes nothing`,
        async () => {
          const payer = await person(200, { preprodEnabled: true });
          const usage = { idempotencyKey: key(), credits: CREDITS };
          expect((await postUsage(first, payer, usage)).status).toBe(201);
          const before = {
            mainnet: await rows("mainnet", payer),
            preprod: await rows("preprod", payer),
          };
          const spent = vi.spyOn(creditBucketRepository, "recordSpend");

          const answer = await postUsage(other(first), payer, usage);

          expect(answer).toMatchObject({
            status: 409,
            body: {
              message: "Idempotency key already used on the other Network",
            },
          });
          // Refused before the debit, not rolled back after it.
          expect(spent).not.toHaveBeenCalled();
          expect({
            mainnet: await rows("mainnet", payer),
            preprod: await rows("preprod", payer),
          }).toEqual(before);
        },
        CASE_TIMEOUT,
      );
    }

    for (const held of NETWORKS) {
      it(
        `lets one of two first uses of a key on the two Networks commit, ${held} held at its debit`,
        async () => {
          const payer = await person(200, { preprodEnabled: true });
          const usage = { idempotencyKey: key(), credits: CREDITS };
          const recordSpend = creditBucketRepository.recordSpend;
          let reached = false;
          let reach: () => void = () => undefined;
          let release: () => void = () => undefined;
          const atDebit = new Promise<void>((resolve) => {
            reach = resolve;
          });
          const released = new Promise<void>((resolve) => {
            release = resolve;
          });
          // The held request has looked the key up on both Networks, found
          // nothing, and waits before its debit.
          vi.spyOn(
            creditBucketRepository,
            "recordSpend",
          ).mockImplementationOnce(async (...args) => {
            reached = true;
            reach();
            await released;
            return recordSpend.apply(creditBucketRepository, args);
          });

          const heldAnswer = postUsage(held, payer, usage);
          await Promise.race([atDebit, heldAnswer]);
          expect(reached, "the held request reached its debit").toBe(true);
          const otherAnswer = await postUsage(other(held), payer, usage);
          release();
          const heldDone = await heldAnswer;

          expect(otherAnswer.status, JSON.stringify(otherAnswer.body)).toBe(
            201,
          );
          expect(heldDone).toMatchObject({
            status: 409,
            body: {
              message: "Idempotency key already used on the other Network",
            },
          });
          const left = {
            [held]: await rows(held, payer),
            [other(held)]: await rows(other(held), payer),
          };
          expect(left[held]?.usage).toEqual([]);
          expect(left[other(held)]?.usage).toMatchObject([
            { id: otherAnswer.body.data?.id },
          ]);
          // The held request's debit rolled back with it.
          expect(
            left[held]?.transactions.filter(({ amount }) => amount < 0n),
          ).toEqual([]);
        },
        CASE_TIMEOUT,
      );
    }
  },
);
