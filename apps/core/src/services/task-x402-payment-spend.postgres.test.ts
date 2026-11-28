/**
 * The Task x402 payment (`POST /v1/tasks/{id}/x402-payments`) on a real
 * PostgreSQL, over HTTP with a real Coworker key, on a deployment whose
 * `NETWORK` is Mainnet and on one whose `NETWORK` is Preprod (the old
 * Preprod), Preprod off. For each case: the answer, whom the low-balance alert
 * was asked for, the demand the payment node was asked to sign and what was
 * committed when it was asked, every credit row, Task, event, payment and
 * audit row left, and the statements PostgreSQL received, with each
 * transaction's boundaries and isolation level. Two payments that spend the
 * same credits at once are run in both orders.
 *
 * The payment's debit goes through the Task writer (`helpers/task-credits.ts`),
 * so it is the credits module's `spend`. Its refund after a node refusal and
 * its low-balance alert do not: they move with the credits module's refund
 * and balance readers (pull requests 8 and 9), and are recorded here as they
 * are. All of it is compared with
 * `task-x402-payment-spend.base.json`, which this file wrote while it ran on
 * `origin/main`'s code:
 * RECORD_TASK_X402_SPEND_BASE=true RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/services/task-x402-payment-spend.postgres.test.ts
 * Without `RECORD_TASK_X402_SPEND_BASE` the same command compares. Each layout
 * has its own cases in the file.
 *
 * It needs the database to itself, as CI gives each worker its own
 * (`POSTGRES_TEST_DATABASE_PER_WORKER`): another file's Serializable
 * transaction on the same database can make a charge retry, and a retry is a
 * second transaction in the statements.
 */
// First: schemas built before this module loads have no `.openapi`, and the
// `/v1` router needs it on the ones `@sokosumi/utils` exports.
import "@hono/zod-openapi";

import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { convertCreditsToCents } from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import { Client, type Pool } from "pg";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { expectCoreLog } from "@/test/core-log";
import {
  baseFile,
  plain,
  type Statement,
  statements,
} from "@/test/spend-comparison";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

const pools = vi.hoisted(() => [] as Pool[]);
/** Work a request hands to `waitUntil`, awaited as part of that request. */
const background = vi.hoisted(() => [] as Promise<unknown>[]);
const outside = vi.hoisted(() => ({
  lowBalanceAlert: vi.fn(async (_billed: unknown) => undefined),
  payX402: vi.fn(),
  /** The next charge throws once, after its debit, inside its transaction. */
  failAfterCharge: false,
  /** Projects whose first charge waits for its release after its debit. */
  held: new Map<string, { reached: () => void; release: Promise<void> }>(),
  /**
   * `observing` of the recorder instance every pool reports to. The mock's
   * factory runs once and survives `vi.resetModules()`, so a recorder
   * imported after a reload would be another instance, with an empty log.
   */
  observing: undefined as
    | typeof import("@/test/spend-comparison").observing
    | undefined,
}));
vi.mock("@vercel/functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/functions")>();
  const { observePool, observing } = await import("@/test/spend-comparison");
  outside.observing = observing;
  return {
    ...actual,
    waitUntil: vi.fn((work: Promise<unknown>) => {
      background.push(work);
    }),
    attachDatabasePool: (pool: Pool) => {
      pools.push(pool);
      observePool(pool);
      actual.attachDatabasePool(pool);
    },
  };
});
// setup.ts mocks this module for every file; its factory result survives
// vi.resetModules(), so a reload with another environment would keep the first.
vi.unmock("@/lib/db/prisma");
// What a payment reaches outside the database. The alert's own reads are
// ticket 27's; here only whom it is asked for is recorded.
vi.mock("@/helpers/billing-notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/billing-notifications")>()),
  notifyLowBalanceAfterCharge: outside.lowBalanceAlert,
}));
vi.mock("@/lib/ably/publish", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ably/publish")>()),
  publishTaskEventData: vi.fn(),
}));
vi.mock("@/helpers/calendar-invalidation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/calendar-invalidation")>()),
  deliverCalendarInvalidationsNow: vi.fn(),
}));
vi.mock("@/helpers/task-notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/task-notifications")>()),
  notifyTaskParticipantsAdded: vi.fn(),
  notifyTaskStatusEvent: vi.fn(),
}));
vi.mock("@/clients/masumi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/masumi")>()),
  masumiClients: () => ({ payment: { payX402: outside.payX402 } }),
}));
// The step after the debit inside the charge's transaction: a case makes it
// throw once, or wait for its release. It sends no statement of its own.
vi.mock("@/helpers/task-event-charge", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/task-event-charge")>();
  return {
    ...actual,
    chargeTaskCreditsOrMarkOutOfCredits: (async (params) => {
      const charge = await actual.chargeTaskCreditsOrMarkOutOfCredits(params);
      if (outside.failAfterCharge) {
        outside.failAfterCharge = false;
        throw new Error("after the charge");
      }
      const held = params.projectId
        ? outside.held.get(params.projectId)
        : undefined;
      if (held && params.projectId) {
        outside.held.delete(params.projectId);
        held.reached();
        await held.release;
      }
      return charge;
    }) satisfies typeof actual.chargeTaskCreditsOrMarkOutOfCredits,
  };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const ORIGIN = "https://example.com";
/**
 * A suite's setup reloads Core's modules and loads all of `/v1`: seconds on a
 * loaded machine, past Vitest's 10 s hook limit on CI's runner.
 */
const SETUP_TIMEOUT = 60_000;
/** A case sends several requests and reads every row back. */
const CASE_TIMEOUT = 60_000;
const DAY = 86_400_000;
const CREDIT = convertCreditsToCents(1);
const LAYOUT = onSplitLayout ? "split layout" : "today's layout";

const base = baseFile(
  fileURLToPath(
    new URL("./task-x402-payment-spend.base.json", import.meta.url),
  ),
  process.env.RECORD_TASK_X402_SPEND_BASE === "true",
  // The Task writer's debit was `recordSpend`'s on `origin/main` already.
  { debitMoved: false },
);

const catalogBase = baseFile(
  fileURLToPath(new URL("./task-payment-catalog.base.json", import.meta.url)),
  process.env.RECORD_TASK_PAYMENT_CATALOG_BASE === "true",
  { debitMoved: false },
);

type DeploymentNetwork = "Mainnet" | "Preprod";

/** Core's modules as a fresh start in this environment loads them. */
async function load(env: Record<string, string>) {
  delete (globalThis as { coreDatabase?: unknown }).coreDatabase;
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const fixture = await import("@/test-fixtures/core-session");
  const { default: prisma } = await import("@/lib/db/prisma");
  const { createNetworkScope } = await import("@/lib/db/network-scope");
  // The product's own creation path, so a fixture workspace has its Files
  // vocabulary (`workspace-creation-chokepoint.test.ts`).
  const { createPersonalWorkspace } = await import(
    "@/helpers/personal-workspace"
  );
  const { workspaceRepository } = await import(
    "@sokosumi/database/repositories"
  );
  // The pool exists once Prisma is loaded: its recorder is the mock's.
  const { observing } = outside;
  if (!observing) throw new Error("No pool reports to a recorder");
  return {
    observing,
    fixture,
    prisma,
    createNetworkScope,
    createPersonalWorkspace,
    workspaceRepository,
    app: fixture.createCoreApp(),
  };
}

type Loaded = Awaited<ReturnType<typeof load>>;

const X402_CHAINS = {
  Mainnet: {
    caip2Network: "eip155:8453",
    asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    name: "USD Coin",
  },
  Preprod: {
    caip2Network: "eip155:84532",
    asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    name: "USDC",
  },
} as const;
const PAY_TO = "0x1111111111111111111111111111111111111111";
const OTHER_PAY_TO = "0x2222222222222222222222222222222222222222";
/** The managed wallet the fixture's node signs with. */
const PAYER = privateKeyToAccount(`0x${"01".repeat(32)}`);
/** What the Agent asks: 2 USDC, at 1 credit per USDC. */
const ASKED = 2_000_000n;

interface Payer {
  ownerId: string | null;
  organizationId: string | null;
  workspaceId: string;
  projectId: string;
}

/**
 * A Coworker with a key, the people and Tasks it bills, an x402 Agent on the
 * deployment's chain, and every row they leave.
 */
function createWorld(loaded: Loaded, deploymentNetwork: DeploymentNetwork) {
  const { prisma } = loaded;
  const runId = randomUUID();
  const mainnet = () => loaded.createNetworkScope("mainnet").networkDb;
  /** Random values in a statement or a row, each under a name. */
  const labels = new Map<string, string>();
  const made = {
    userIds: [] as string[],
    organizationIds: [] as string[],
    workspaceIds: [] as string[],
    projectIds: [] as string[],
    taskIds: [] as string[],
    vendorIds: [] as string[],
  };
  /** Removals of rows no fixture person or Task ties, newest first. */
  const removals: (() => Promise<unknown>)[] = [];
  let coworker: { id: string; token: string; keyHash: string } | undefined;

  const billedTo = () => ({
    OR: [
      { userId: { in: made.userIds } },
      { organizationId: { in: made.organizationIds } },
    ],
  });
  const paymentIds = async () =>
    (
      await mainnet().taskX402Payment.findMany({
        where: { taskId: { in: made.taskIds } },
        select: { id: true },
      })
    ).map((payment) => payment.id);

  /** A bucket of the payer's credits, under a name its rows are read by. */
  async function grant(
    name: string,
    owner: { userId: string } | { organizationId: string },
    bucket: { cents: bigint; expiresInDays: number; projectId?: string },
  ) {
    const created = await mainnet().transaction.create({
      data: {
        amount: bucket.cents,
        ...owner,
        sourceCreditBucket: {
          create: {
            amount: bucket.cents,
            ...owner,
            expiresAt: new Date(Date.now() + bucket.expiresInDays * DAY),
            ...(bucket.projectId && { projectId: bucket.projectId }),
          },
        },
      },
      select: { id: true, sourceCreditBucket: { select: { id: true } } },
    });
    labels.set(created.id, `<grant of ${name}>`);
    if (created.sourceCreditBucket)
      labels.set(created.sourceCreditBucket.id, `<bucket ${name}>`);
  }

  async function createProject(workspaceId: string, name: string) {
    const project = await prisma.project.create({
      data: { workspaceId, name: `${name}'s Project ${runId}` },
      select: { id: true },
    });
    made.projectIds.push(project.id);
    labels.set(project.id, `<${name}'s Project>`);
    return project.id;
  }

  /** A credit cost of 1 credit per unit, removed with the fixture. */
  async function creditCost(unit: string) {
    const scope = loaded.createNetworkScope("mainnet");
    const id = randomUUID();
    const write = (remove: boolean) =>
      scope.netTransaction(async (tx) => {
        // shortcut: the unit trigger calls `public.canonical_credit_cost_unit`,
        // which the split layout moved to `shared`; drop this line with ticket 19.
        if (onSplitLayout) {
          await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        }
        if (remove) await tx.creditCost.deleteMany({ where: { id } });
        else
          await tx.creditCost.create({
            data: { id, unit, centsPerUnit: 10n ** 10n },
          });
      }, "Fixture conflict");
    removals.push(() => write(true));
    await write(false);
  }

  return {
    labels,
    made,
    grant,
    creditCost,

    /** A Coworker that may work on Tasks, and its key. */
    async coworker() {
      if (coworker) return coworker;
      const { token, vendorId } = await loaded.fixture.createCoworkerKey();
      made.vendorIds.push(vendorId);
      const row = await prisma.coworker.findFirstOrThrow({
        where: { vendorId },
      });
      await prisma.coworker.update({
        where: { id: row.id },
        data: { capabilities: ["tasks"], isWhitelisted: true },
      });
      labels.set(row.id, "<coworker>");
      labels.set(row.slug, "<coworker slug>");
      labels.set(vendorId, "<vendor>");
      // The key's hash is bound in the authentication read.
      const { hashApiKey } = await import("@/lib/coworker-api-key");
      const keyHash = await hashApiKey(token);
      labels.set(keyHash, "<coworker key hash>");
      coworker = { id: row.id, token, keyHash };
      return coworker;
    },

    /**
     * A person in the personal workspace the product creates, with two
     * buckets: the one that expires first holds one credit, so a payment of
     * two credits spends from both.
     */
    async person(name: string, laterCredits = 3n): Promise<Payer> {
      const user = await loaded.fixture.createPasswordUser(`${name} ${runId}`);
      made.userIds.push(user.id);
      labels.set(user.id, `<${name}>`);
      labels.set(user.email, `<${name}'s email>`);
      const workspace = await loaded.createPersonalWorkspace(user.id);
      made.workspaceIds.push(workspace.id);
      labels.set(workspace.id, `<${name}'s workspace>`);
      // The sign-up and free plan grants are other writers' and differ in
      // size: the fixture's own buckets replace them.
      await mainnet().creditBucket.deleteMany({ where: { userId: user.id } });
      await mainnet().transaction.deleteMany({ where: { userId: user.id } });
      if (laterCredits > 0n) {
        await grant(
          `expiring later of ${name}`,
          { userId: user.id },
          { cents: laterCredits * CREDIT, expiresInDays: 20 },
        );
        await grant(
          `expiring first of ${name}`,
          { userId: user.id },
          { cents: CREDIT, expiresInDays: 1 },
        );
      }
      return {
        ownerId: user.id,
        organizationId: null,
        workspaceId: workspace.id,
        projectId: await createProject(workspace.id, name),
      };
    },

    /**
     * An Organization with one seated member, whose Project holds half a
     * credit of Project credits beside a pool of one credit that expires
     * soon and three that expire later. Granted latest-expiring first: the
     * spend order is not the creation order.
     */
    async organization(name: string): Promise<Payer> {
      const member = await loaded.fixture.createPasswordUser(
        `${name}'s member ${runId}`,
      );
      made.userIds.push(member.id);
      labels.set(member.id, `<${name}'s member>`);
      labels.set(member.email, `<${name}'s member's email>`);
      const organizationId = `task-x402-spend-${randomUUID()}`;
      await prisma.organization.create({
        data: {
          id: organizationId,
          name: `Task x402 spend fixture ${runId}`,
          slug: organizationId,
          members: {
            create: {
              userId: member.id,
              role: "member",
              seatAssignedAt: new Date(),
            },
          },
        },
      });
      made.organizationIds.push(organizationId);
      labels.set(organizationId, `<${name}>`);
      const workspace =
        await loaded.workspaceRepository.upsertOrganizationWorkspace({
          organizationId,
          tx: prisma,
        });
      made.workspaceIds.push(workspace.id);
      labels.set(workspace.id, `<${name}'s workspace>`);
      const projectId = await createProject(workspace.id, name);
      const owner = { organizationId };
      await grant(`pool later of ${name}`, owner, {
        cents: 3n * CREDIT,
        expiresInDays: 20,
      });
      await grant(`pool soon of ${name}`, owner, {
        cents: CREDIT,
        expiresInDays: 5,
      });
      await grant(`Project credits of ${name}`, owner, {
        cents: CREDIT / 2n,
        expiresInDays: 40,
        projectId,
      });
      return {
        ownerId: member.id,
        organizationId,
        workspaceId: workspace.id,
        projectId,
      };
    },

    /** A Task of the payer, assigned to the Coworker. */
    async task(
      payer: Payer,
      name: string,
      status: "RUNNING" | "COMPLETED" = "RUNNING",
    ) {
      const created = await prisma.task.create({
        data: {
          ownerId: payer.ownerId,
          creatorUserId: payer.ownerId,
          organizationId: payer.organizationId,
          workspaceId: payer.workspaceId,
          projectId: payer.projectId,
          assigneeId: (await this.coworker()).id,
          name: `Task x402 spend fixture ${runId}`,
          status,
        },
      });
      made.taskIds.push(created.id);
      labels.set(created.id, `<${name}>`);
      return created.id;
    },

    /**
     * A listed x402 Agent that asks 2 USDC on `chain`, buy-side ready on the
     * deployment's chain, and the 402 it answers.
     */
    async x402Agent(name: string, chain: DeploymentNetwork) {
      const { caip2Network, asset, name: assetName } = X402_CHAINS[chain];
      const ready = X402_CHAINS[deploymentNetwork];
      const key = "x402-buy-side-readiness";
      const kept = await prisma.syncMetadata.findUnique({ where: { key } });
      const cursorId = JSON.stringify([
        {
          caip2Network: ready.caip2Network,
          asset: ready.asset,
          decimals: 6,
          evmWalletId: "fixture-wallet",
          evmWalletAddress: PAYER.address.toLowerCase(),
        },
      ]);
      const readiness = await prisma.syncMetadata.upsert({
        where: { key },
        create: { key, cursorId, lastSyncedAt: new Date() },
        update: { cursorId, lastSyncedAt: new Date() },
      });
      removals.push(() =>
        kept
          ? prisma.syncMetadata.update({ where: { id: kept.id }, data: kept })
          : prisma.syncMetadata.deleteMany({ where: { id: readiness.id } }),
      );
      const unit = `${caip2Network}/erc20:${asset}`;
      if (!(await mainnet().creditCost.findFirst({ where: { unit } }))) {
        await creditCost(unit);
      }
      const ids = { agent: randomUUID(), pricing: randomUUID() };
      removals.push(async () => {
        await mainnet().agent.deleteMany({ where: { id: ids.agent } });
        await mainnet().agentPricing.deleteMany({
          where: { id: ids.pricing },
        });
      });
      labels.set(ids.agent, `<${name}>`);
      const blockchainIdentifier = randomUUID();
      labels.set(blockchainIdentifier, `<${name}'s identifier>`);
      await mainnet().agent.create({
        data: {
          id: ids.agent,
          blockchainIdentifier,
          type: "X402",
          name: `Task x402 spend fixture ${runId}`,
          description: "Fixture",
          isShown: true,
          lastUptimeCheck: new Date(),
          uptimeCount: 1,
          uptimeCheckCount: 1,
          x402ResourcesUrl: "https://agent.example.com/.well-known/x402",
          pricing: { create: { id: ids.pricing, pricingType: "UNKNOWN" } },
          paymentSources: {
            create: {
              sourceIndex: 0,
              chain: "EVM",
              network: caip2Network,
              scheme: "exact",
              payTo: PAY_TO,
              address: asset,
              pricingType: "FIXED",
              amounts: { create: { unit: asset, amount: ASKED, decimals: 6 } },
            },
          },
        },
      });
      const accepted = (payTo: string) => ({
        scheme: "exact",
        network: caip2Network,
        asset,
        amount: String(ASKED),
        payTo,
        maxTimeoutSeconds: 60,
        extra: { name: assetName, version: "2" },
      });
      return {
        /** The request that pays the Agent's 402 under this key. */
        pay(
          key: string,
          options: { payTo?: string; maxCredits?: number } = {},
        ) {
          const idempotencyKey = `${key}:${randomUUID()}`;
          labels.set(idempotencyKey, `<key ${key}>`);
          return {
            idempotencyKey,
            agentId: ids.agent,
            paymentRequired: {
              x402Version: 2,
              accepts: [accepted(options.payTo ?? PAY_TO)],
            },
            ...(options.maxCredits !== undefined && {
              maxCredits: options.maxCredits,
            }),
          };
        },
        /**
         * The node's answer with a real EIP-3009 authorization, which Core
         * verifies. It signs only the demand the Agent asked: one entry, on
         * the wallet, chain and asset of the deployment's ready source.
         * Anything else is refused, as the node refuses a 402 it cannot sign.
         */
        async signed(request: unknown) {
          const asked = request as {
            evmWalletId?: unknown;
            paymentRequired?: { x402Version?: unknown; accepts?: unknown };
            preferredNetwork?: unknown;
            preferredAsset?: unknown;
          };
          const expected = {
            evmWalletId: "fixture-wallet",
            paymentRequired: { x402Version: 2, accepts: [accepted(PAY_TO)] },
            preferredNetwork: caip2Network,
            preferredAsset: asset,
          };
          const forwarded = {
            evmWalletId: asked.evmWalletId,
            paymentRequired: {
              x402Version: asked.paymentRequired?.x402Version,
              accepts: asked.paymentRequired?.accepts,
            },
            preferredNetwork: asked.preferredNetwork,
            preferredAsset: asked.preferredAsset,
          };
          if (!isDeepStrictEqual(forwarded, expected)) {
            return err({
              kind: "refused" as const,
              status: 400,
              message: "fixture: not the demand the Agent asked",
              nodeMessage: "fixture: not the demand the Agent asked",
            });
          }
          const nonce = `0x${randomBytes(32).toString("hex")}` as const;
          labels.set(nonce, "<nonce>");
          const validBefore = Math.floor(Date.now() / 1000) + 60;
          const signature = await PAYER.signTypedData({
            domain: {
              name: assetName,
              version: "2",
              chainId: Number(caip2Network.split(":")[1]),
              verifyingContract: asset,
            },
            types: {
              TransferWithAuthorization: [
                { name: "from", type: "address" },
                { name: "to", type: "address" },
                { name: "value", type: "uint256" },
                { name: "validAfter", type: "uint256" },
                { name: "validBefore", type: "uint256" },
                { name: "nonce", type: "bytes32" },
              ],
            },
            primaryType: "TransferWithAuthorization",
            message: {
              from: PAYER.address,
              to: PAY_TO,
              value: ASKED,
              validAfter: 0n,
              validBefore: BigInt(validBefore),
              nonce,
            },
          });
          const authorization = {
            from: PAYER.address.toLowerCase(),
            to: PAY_TO,
            value: String(ASKED),
            validAfter: "0",
            validBefore: String(validBefore),
            nonce,
          };
          const xPaymentHeader = Buffer.from(
            JSON.stringify({
              x402Version: 2,
              accepted: accepted(PAY_TO),
              payload: { signature, authorization },
            }),
          ).toString("base64");
          labels.set(xPaymentHeader, "<signed header>");
          const paymentPayloadHash = `0x${randomBytes(32).toString("hex")}`;
          labels.set(paymentPayloadHash, "<payload hash>");
          return ok({
            attemptId: "fixture-attempt",
            payer: PAYER.address.toLowerCase(),
            caip2Network,
            asset,
            amount: String(ASKED),
            payTo: PAY_TO,
            xPaymentHeader,
            paymentPayload: { payload: { authorization } },
            paymentPayloadHash,
            paymentIdentifier: null,
          });
        },
        /** Lets the lease of the Agent's pending payments run out. */
        expireLeases: () =>
          mainnet().taskX402Payment.updateMany({
            where: { agentId: ids.agent, status: "PENDING" },
            data: { processingAt: new Date(Date.now() - 60 * 60_000) },
          }),
      };
    },

    /**
     * Every credit row of the fixture's payers, and every receipt of their
     * payments: Tasks, events, payments and their audit rows.
     */
    async rows() {
      const db = mainnet();
      return {
        buckets: await db.creditBucket.findMany({
          where: billedTo(),
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            amount: true,
            userId: true,
            organizationId: true,
            projectId: true,
            consumptions: {
              orderBy: { id: "asc" },
              select: { amount: true, transactionId: true },
            },
          },
        }),
        transactions: await db.transaction.findMany({
          where: billedTo(),
          orderBy: { id: "asc" },
        }),
        consumptions: await db.creditConsumption.findMany({
          where: { transaction: billedTo() },
          orderBy: [{ transactionId: "asc" }, { bucket: { expiresAt: "asc" } }],
        }),
        tasks: await prisma.task.findMany({
          where: { id: { in: made.taskIds } },
          orderBy: { createdAt: "asc" },
          select: { id: true, status: true },
        }),
        events: await prisma.taskEvent.findMany({
          where: { taskId: { in: made.taskIds } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            createdAt: true,
            taskId: true,
            status: true,
            comment: true,
            cents: true,
            transactionId: true,
            network: true,
            userId: true,
            coworkerId: true,
            sokoBotId: true,
            channel: true,
          },
        }),
        payments: await db.taskX402Payment.findMany({
          where: { taskId: { in: made.taskIds } },
          orderBy: { createdAt: "asc" },
        }),
        paymentActions: await db.taskX402PaymentAction.findMany({
          where: { paymentId: { in: await paymentIds() } },
          orderBy: { id: "asc" },
        }),
      };
    },

    /** Every row the fixture caused. */
    async remove() {
      const db = mainnet();
      await db.taskX402PaymentAction.deleteMany({
        where: { paymentId: { in: await paymentIds() } },
      });
      await db.taskX402Payment.deleteMany({
        where: { taskId: { in: made.taskIds } },
      });
      await prisma.task.deleteMany({ where: { id: { in: made.taskIds } } });
      await db.creditConsumption.deleteMany({
        where: { transaction: billedTo() },
      });
      await db.creditBucket.deleteMany({ where: billedTo() });
      await db.transaction.deleteMany({ where: billedTo() });
      for (const removal of removals.reverse()) await removal();
      await prisma.project.deleteMany({
        where: { id: { in: made.projectIds } },
      });
      await prisma.coworker.deleteMany({
        where: { vendorId: { in: made.vendorIds } },
      });
      await prisma.vendor.deleteMany({ where: { id: { in: made.vendorIds } } });
      await prisma.workspace.deleteMany({
        where: { id: { in: made.workspaceIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: made.organizationIds } },
      });
      // The free plan `createPersonalWorkspace` grants is not tied to the user.
      await prisma.subscription.deleteMany({
        where: { referenceId: { in: made.userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: made.userIds } } });
    },
  };
}

type World = ReturnType<typeof createWorld>;

/** Keep the shared key stale until both requests have authenticated. */
async function lockCoworkerKeyUse(world: World) {
  const { keyHash } = await world.coworker();
  const { DATABASE_SCHEMA_SHARED: shared } = testSchemaNames();
  // A separate connection locks the row without adding fixture SQL to the recording.
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query("BEGIN");
    const key = await client.query(
      `SELECT id FROM "${shared}"."coworker_api_key" WHERE "keyHash" = $1 FOR NO KEY UPDATE`,
      [keyHash],
    );
    expect(key.rowCount).toBe(1);
    return client;
  } catch (error) {
    await client.end();
    throw error;
  }
}

/**
 * What was committed when the node was asked to sign, read on a connection of
 * its own, outside Core's pool: the payment row, its debit and its event.
 */
async function committedAtSigning(paymentIdentifierTaskIds: readonly string[]) {
  const { DATABASE_SCHEMA_SHARED: shared, DATABASE_SCHEMA_MAINNET: network } =
    testSchemaNames();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT p.status, p."signAttemptCount", t.amount::text AS debit,
              e.cents::text AS "eventCents", e."transactionId" = p."transactionId" AS "eventLinked"
         FROM "${network}"."task_x402_payment" p
         JOIN "${network}"."Transaction" t ON t.id = p."transactionId"
         LEFT JOIN "${shared}"."taskEvent" e ON e.id = p."taskEventId"
        WHERE p."taskId" = ANY($1::text[])
        ORDER BY p."createdAt"`,
      [paymentIdentifierTaskIds],
    );
    return rows;
  } finally {
    await client.end();
  }
}

/**
 * The statements of two connections that ran at once. Which one sends first
 * is the scheduler's choice, so each transaction is made plain on its own (its
 * ids numbered within it), and the transactions are a sorted list. Each
 * transaction's own order, values, boundaries and isolation level stay.
 */
function interleaved(
  transactions: Statement[][],
  labels: ReadonlyMap<string, string>,
) {
  return transactions
    .map((transaction) => plain(transaction, labels))
    .sort(byJson);
}

function byJson(a: unknown, b: unknown) {
  const [x, y] = [JSON.stringify(a), JSON.stringify(b)];
  return x < y ? -1 : x > y ? 1 : 0;
}

/** A case of several requests: each step under its own key, in order. */
function expectStepsAsOnBase(name: string, steps: Record<string, unknown>) {
  for (const [step, observed] of Object.entries(steps)) {
    base.expectAsOnBase(`${name}, ${step}`, observed);
  }
}

/** Runs `act` and records what it answered and sent, and the rows after it. */
async function observe(
  loaded: Loaded,
  world: World,
  act: () => Promise<unknown>,
  options: { interleaved?: boolean } = {},
) {
  outside.lowBalanceAlert.mockClear();
  outside.payX402.mockClear();
  const signing: unknown[] = [];
  const node = outside.payX402.getMockImplementation();
  outside.payX402.mockImplementation(async (...args: unknown[]) => {
    signing.push(await committedAtSigning(world.made.taskIds));
    return node?.(...args);
  });
  const { outcome: answer, log } = await loaded.observing(async () => {
    try {
      return await act();
    } finally {
      while (background.length > 0) {
        await Promise.allSettled(background.splice(0));
      }
    }
  });
  if (node) outside.payX402.mockImplementation(node);
  // Every request reads its payment row first, with its Task and key bound:
  // an observation without that read recorded nothing, even while recording.
  expect(
    log.filter(
      ({ text, values }) =>
        text.includes("task_x402_payment") &&
        text.trimStart().startsWith("SELECT") &&
        world.made.taskIds.includes(String(values[0])),
    ).length,
  ).toBeGreaterThan(0);
  const left = await world.rows();
  // Two Tasks made in the same millisecond have no order of their own: by
  // their names, each Task's events in the order they were written.
  const named = (id: string) => world.labels.get(id) ?? id;
  const byName = (a: string, b: string) =>
    named(a) < named(b) ? -1 : named(a) > named(b) ? 1 : 0;
  left.tasks.sort((a, b) => byName(a.id, b.id));
  left.events.sort((a, b) => byName(a.taskId, b.taskId));
  const sent = statements(log, { asSent: true });
  // Before `plain` turns ids and times into names: a debit's rows are UUID v7,
  // and a debit is one instant, its update time and each consumption's
  // creation time equal its creation time.
  for (const debit of left.transactions.filter((row) => row.amount < 0n)) {
    expect(debit.amount).toBe(-2n * CREDIT);
    const consumptions = left.consumptions.filter(
      (consumption) => consumption.transactionId === debit.id,
    );
    expect([debit, ...consumptions].map((row) => row.id.charAt(14))).toEqual(
      [debit, ...consumptions].map(() => "7"),
    );
    const times = [
      debit.updatedAt,
      ...consumptions.map((consumption) => consumption.createdAt),
    ];
    expect(times.map((time) => time.getTime())).toEqual(
      times.map(() => debit.createdAt.getTime()),
    );
    // The history reader names a spend's Project by its first consumption
    // (lowest createdAt, then id): in the request that wrote the debit, that
    // order is the order the buckets were chosen in, as the write bound them.
    const write = sent.transactions
      .flat()
      .find(
        ({ sql, values }) =>
          sql.includes("credit_consumption") && values[1] === debit.id,
      );
    if (write) {
      expect(
        [...consumptions]
          .sort(
            (a, b) =>
              a.createdAt.getTime() - b.createdAt.getTime() ||
              (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
          )
          .map((consumption) => consumption.bucketId),
      ).toEqual(write.values[4]);
    }
    // The receipts are written after the debit, in the same transaction: its
    // charge event, then the payment row, each no earlier than the one before.
    // Not one instant: the Task writer returns only the debit's id, so they
    // keep their own clock, not `spend`'s `createdAt`.
    const receipts = [
      ...left.events.filter((event) => event.transactionId === debit.id),
      ...left.payments.filter((payment) => payment.transactionId === debit.id),
    ];
    const receiptTimes = [debit, ...receipts].map((row) =>
      row.createdAt.getTime(),
    );
    expect(receiptTimes).toEqual([...receiptTimes].sort((a, b) => a - b));
  }
  // Made plain one by one and sorted: work beside the request can interleave.
  const outsideTransactions = sent.outsideTransactions
    .map((statement) => plain(statement, world.labels))
    .sort(byJson);
  return plain(
    {
      answer,
      lowBalanceAlerts: outside.lowBalanceAlert.mock.calls.map(
        ([billed]) => billed,
      ),
      nodeSigns: outside.payX402.mock.calls.map((call) => {
        const request = call[0] as Record<string, unknown>;
        return {
          evmWalletId: request.evmWalletId,
          preferredNetwork: request.preferredNetwork,
          preferredAsset: request.preferredAsset,
          paymentIdentifier: request.paymentIdentifier,
          paymentRequired: request.paymentRequired,
        };
      }),
      committedAtSigning: signing,
      statements: {
        transactions: options.interleaved
          ? interleaved(sent.transactions, world.labels)
          : sent.transactions,
        outsideTransactions,
      },
      rows: left,
    },
    world.labels,
  );
}

/** A Coworker's payment over HTTP: its status and body, without time and request id. */
async function pay(
  loaded: Loaded,
  world: World,
  taskId: string,
  body: unknown,
  network?: "mainnet" | "preprod",
) {
  const response = await loaded.app.request(
    `${ORIGIN}/v1/tasks/${taskId}/x402-payments`,
    {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        authorization: `Bearer ${(await world.coworker()).token}`,
        ...(network && { "X-Sokosumi-Network": network }),
      },
      body: JSON.stringify(body),
    },
  );
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  const meta = parsed?.meta as Record<string, unknown> | undefined;
  if (meta) {
    delete meta.timestamp;
    delete meta.requestId;
  }
  return { status: response.status, body: parsed };
}

/**
 * Where the route stops on the split layout, as on `origin/main`: its first
 * read of the payment row is on the default client, which has no Network
 * table there (allowlist line of `task-x402-payment.service.ts`), so every
 * request answers 500 before its transaction opens, with nothing charged.
 * Each such request logs this once.
 */
function stopsOnTheSplitLayout(requests: number) {
  if (onSplitLayout)
    expectCoreLog(
      "error",
      "Kept a database schema mismatch out of Sentry",
      requests,
    );
}

const refused = err({
  kind: "refused",
  status: 400,
  message: "fixture refusal",
  nodeMessage: "fixture refusal",
});
const lost = err({ kind: "ambiguous", message: "fixture lost answer" });

afterAll(async () => {
  vi.unstubAllEnvs();
  await Promise.all(pools.map((pool) => pool.end()));
});

describe.runIf(enabled).each(["Mainnet", "Preprod"] as const)(
  "the Task x402 payment's charge on a deployment with NETWORK=%s, Preprod off, as on origin/main (PostgreSQL)",
  (deploymentNetwork) => {
    let loaded: Loaded;
    const otherChain = "Preprod";
    const key = (name: string) => `${LAYOUT}, NETWORK=Mainnet: ${name}`;

    let setup: Promise<void> | undefined;
    beforeAll(() => {
      setup = (async () => {
        loaded = await load({ NETWORK: deploymentNetwork });
      })();
      return setup;
    }, SETUP_TIMEOUT);

    afterAll(() => setup?.catch(() => undefined), SETUP_TIMEOUT);

    /** Runs a case with its own Coworker, people and rows, removed after it. */
    async function withWorld(run: (world: World) => Promise<void>) {
      const originalReadiness = () =>
        loaded.prisma.syncMetadata.findUnique({
          where: { key: "x402-buy-side-readiness" },
        });
      const before = await originalReadiness();
      const world = createWorld(loaded, "Mainnet");
      const now = new Date();
      // Hold the auth throttle, payment leases and signing deadlines steady
      // across requests. PostgreSQL and the concurrency gates still run live.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now);
      try {
        await run(world);
      } finally {
        vi.useRealTimers();
        await world.remove();
        expect(await originalReadiness()).toEqual(before);
      }
    }

    it(
      "keeps the catalog refusal order before any charge",
      () =>
        withWorld(async (world) => {
          const scope = loaded.createNetworkScope("mainnet");
          const payer = await world.person("catalog refusal payer");
          const taskId = await world.task(payer, "catalog refusal Task");
          const wrongChain = await world.x402Agent("wrong chain", otherChain);
          const ready = await world.x402Agent("ready", "Mainnet");
          const badSource = wrongChain.pay("bad source", {
            payTo: OTHER_PAY_TO,
          });
          const badDemand = ready.pay("bad demand", { payTo: OTHER_PAY_TO });
          const before = await world.rows();
          stopsOnTheSplitLayout(9);
          outside.payX402.mockClear();
          for (const header of [undefined, "mainnet", "preprod"] as const) {
            for (const [reason, body, status] of [
              ["not listed", badSource, "OFFLINE"],
              ["not payable", badSource, "ONLINE"],
              ["demand mismatch", badDemand, "ONLINE"],
            ] as const) {
              await scope.networkDb.agent.update({
                where: { id: body.agentId },
                data: { status },
              });
              const { outcome, log } = await loaded.observing(() =>
                pay(loaded, world, taskId, body, header),
              );
              expect(log.length).toBeGreaterThan(0);
              expect(outside.payX402).not.toHaveBeenCalled();
              expect(await world.rows()).toEqual(before);
              catalogBase.expectAsOnBase(
                // A refused Network header must still reach these same pre-authorization gates.
                key(`${reason}, ${header ? "mainnet" : "no header"}`),
                plain({ outcome, statements: statements(log) }, world.labels),
              );
            }
          }
        }),
      CASE_TIMEOUT,
    );

    it(
      "quotes the V2 Task event on its open transaction",
      () =>
        withWorld(async (world) => {
          const { settleTaskEventCharge } = await import(
            "@/routes/v1/tasks/[id]/events/settle-charge"
          );
          const scope = loaded.createNetworkScope("mainnet");
          const metadata = { key: "cardano-v2-rail-readiness" };
          const saved = await loaded.prisma.syncMetadata.findUnique({
            where: metadata,
          });
          const payer = await world.person("V2 event payer");
          const taskId = await world.task(payer, "V2 event Task");
          const before = await world.rows();
          const unit = randomBytes(30).toString("hex");
          world.labels.set(unit, "<event unit>");
          await world.creditCost(unit);
          const policyId = randomBytes(28).toString("hex");
          const source = {
            policyId,
            smartContractAddress:
              deploymentNetwork === "Mainnet"
                ? "addr1_catalog"
                : "addr_test1_catalog",
          };
          const masumiPayment = {
            paymentSourceType: "Web3CardanoV2" as const,
            PaymentSource: { ...source, network: deploymentNetwork },
            Amounts: [{ amount: "3", unit }],
            agentIdentifier: `${policyId}01`,
            blockchainIdentifier: "event",
            identifierFromPurchaser: "aabbccddeeff0011",
            sellerVkey: "ab".repeat(28),
            inputHash: "ab".repeat(32),
            submitResultTime: "1",
            payByTime: "2",
            unlockTime: "3",
            externalDisputeUnlockTime: "4",
          };
          const rollback = new Error(
            "Roll back the quoted event and its readiness",
          );
          await expect(
            loaded.prisma.$transaction(async (tx) => {
              const cursorId = JSON.stringify([source]);
              await tx.syncMetadata.upsert({
                where: metadata,
                create: { ...metadata, cursorId, lastSyncedAt: new Date() },
                update: { cursorId },
              });
              const { outcome, log } = await loaded.observing(async () => {
                try {
                  const result = await settleTaskEventCharge({
                    scope,
                    tx,
                    task: { ...payer, status: "RUNNING" },
                    masumiPayment,
                  });
                  expect(result.cents).toBe(3n * CREDIT);
                  return result;
                } catch (error) {
                  // The legacy charge transaction has no CreditCost table after the split.
                  if (
                    onSplitLayout &&
                    error instanceof Error &&
                    "code" in error &&
                    error.code === "P2021"
                  )
                    return { code: error.code };
                  throw error;
                }
              });
              expect(outcome).not.toHaveProperty("threw");
              expect(log.length).toBeGreaterThan(0);
              expect(new Set(log.map((s) => s.connection)).size).toBe(1);
              // Observation starts on the already-open connection, so retain its exact statement order.
              catalogBase.expectAsOnBase(
                `${LAYOUT}, NETWORK=${deploymentNetwork}: V2 event price`,
                plain(
                  {
                    outcome,
                    statements: {
                      transactions: [
                        statements(log, { asSent: true }).outsideTransactions,
                      ],
                    },
                  },
                  world.labels,
                ),
              );
              throw rollback;
            }),
          ).rejects.toBe(rollback);
          expect(
            await loaded.prisma.syncMetadata.findUnique({ where: metadata }),
          ).toEqual(saved);
          if (!onSplitLayout) {
            const { outcome, log } = await loaded.observing(async () => {
              const response = await loaded.app.request(
                `${ORIGIN}/v1/tasks/${taskId}/events`,
                {
                  method: "POST",
                  headers: {
                    origin: ORIGIN,
                    "content-type": "application/json",
                    authorization: `Bearer ${(await world.coworker()).token}`,
                    "X-Sokosumi-Network": "preprod",
                  },
                  body: JSON.stringify({ masumiPayment }),
                },
              );
              return { status: response.status, body: await response.json() };
            });
            expect(outcome).toMatchObject({
              status: 403,
              body: { kind: "preprod_off" },
            });
            expect(log.length).toBeGreaterThan(0);
            expect(log.some((s) => s.values.includes(metadata.key))).toBe(
              false,
            );
          }
          expect(await world.rows()).toEqual(before);
        }),
      CASE_TIMEOUT,
    );

    it.each([undefined, "mainnet"] as const)(
      "charges a fresh payment to the Owner's personal credits, signs it, and replays it (Network header %s)",
      (header) =>
        withWorld(async (world) => {
          stopsOnTheSplitLayout(2);
          const payer = await world.person("paying person");
          const taskId = await world.task(payer, "paying person's Task");
          const agent = await world.x402Agent("Agent", "Mainnet");
          const body = agent.pay("fresh");
          outside.payX402.mockImplementation((request) =>
            agent.signed(request),
          );

          const fresh = await observe(loaded, world, () =>
            pay(loaded, world, taskId, body, header),
          );
          const verifiedReplay = await observe(loaded, world, () =>
            pay(loaded, world, taskId, body, header),
          );

          expectStepsAsOnBase(key("an Owner's personal credits"), {
            fresh,
            verifiedReplay,
          });
        }),
      CASE_TIMEOUT,
    );

    it(
      "charges an Owner in an Organization, the Project's credits first",
      () =>
        withWorld(async (world) => {
          stopsOnTheSplitLayout(1);
          const payer = await world.organization("Owner's Organization");
          const taskId = await world.task(payer, "Organization Task");
          const agent = await world.x402Agent("Agent", "Mainnet");
          outside.payX402.mockImplementation((request) =>
            agent.signed(request),
          );

          base.expectAsOnBase(
            key("an Owner in an Organization"),
            await observe(loaded, world, () =>
              pay(loaded, world, taskId, agent.pay("organization")),
            ),
          );
        }),
      CASE_TIMEOUT,
    );

    it(
      "holds a payment whose sign answer is lost, refuses its key while leased, and signs it on replay",
      () =>
        withWorld(async (world) => {
          stopsOnTheSplitLayout(3);
          const payer = await world.person("pending person");
          const taskId = await world.task(payer, "pending person's Task");
          const agent = await world.x402Agent("Agent", "Mainnet");
          const body = agent.pay("pending");

          outside.payX402.mockResolvedValue(lost);
          const lostAnswer = await observe(loaded, world, () =>
            pay(loaded, world, taskId, body),
          );
          const whileLeased = await observe(loaded, world, () =>
            pay(loaded, world, taskId, body),
          );
          await agent.expireLeases();
          outside.payX402.mockImplementation((request) =>
            agent.signed(request),
          );
          const pendingReplay = await observe(loaded, world, () =>
            pay(loaded, world, taskId, body),
          );

          expectStepsAsOnBase(key("a PENDING payment replayed"), {
            lostAnswer,
            whileLeased,
            pendingReplay,
          });
        }),
      CASE_TIMEOUT,
    );

    it(
      "refunds a payment the node refuses, and answers its key as consumed",
      () =>
        withWorld(async (world) => {
          stopsOnTheSplitLayout(2);
          const payer = await world.person("refused person");
          const taskId = await world.task(payer, "refused person's Task");
          const agent = await world.x402Agent("Agent", "Mainnet");
          const body = agent.pay("refused");
          outside.payX402.mockImplementation(() => {
            // The debit's native UUIDv7 uses real time. Give Prisma's refund
            // UUIDv7 a later timestamp so ID order follows the two writes.
            vi.setSystemTime(vi.getRealSystemTime() + 1);
            return refused;
          });

          const refusal = await observe(loaded, world, () =>
            pay(loaded, world, taskId, body),
          );
          const again = await observe(loaded, world, () =>
            pay(loaded, world, taskId, body),
          );

          expectStepsAsOnBase(key("a payment the node refuses"), {
            refusal,
            again,
          });
        }),
      CASE_TIMEOUT,
    );

    it(
      "rolls the debit back with the payment when its transaction fails after the charge",
      () =>
        withWorld(async (world) => {
          stopsOnTheSplitLayout(2);
          const payer = await world.person("rolled back person");
          const taskId = await world.task(payer, "rolled back person's Task");
          const agent = await world.x402Agent("Agent", "Mainnet");
          const body = agent.pay("rolled back");
          outside.payX402.mockImplementation((request) =>
            agent.signed(request),
          );

          const failed = await observe(loaded, world, () => {
            outside.failAfterCharge = true;
            return pay(loaded, world, taskId, body);
          });
          const again = await observe(loaded, world, () =>
            pay(loaded, world, taskId, body),
          );

          expectStepsAsOnBase(key("a failed transaction, then charged"), {
            failed,
            again,
          });
        }),
      CASE_TIMEOUT,
    );

    it(
      "refuses a demand that does not verify before any charge",
      () =>
        withWorld(async (world) => {
          stopsOnTheSplitLayout(3);
          const payer = await world.person("mismatched person");
          const taskId = await world.task(payer, "mismatched person's Task");
          const agent = await world.x402Agent("Agent", "Mainnet");
          const otherChainAgent = await world.x402Agent(
            "Agent on the other chain",
            otherChain,
          );
          outside.payX402.mockImplementation((request) =>
            agent.signed(request),
          );

          const answers = {
            otherPayTo: await observe(loaded, world, () =>
              pay(
                loaded,
                world,
                taskId,
                agent.pay("other payTo", { payTo: OTHER_PAY_TO }),
              ),
            ),
            overMaxCredits: await observe(loaded, world, () =>
              pay(
                loaded,
                world,
                taskId,
                agent.pay("over maxCredits", { maxCredits: 1 }),
              ),
            ),
            otherChain: await observe(loaded, world, () =>
              pay(loaded, world, taskId, otherChainAgent.pay("other chain")),
            ),
          };

          expectStepsAsOnBase(key("a demand that does not verify"), answers);
        }),
      CASE_TIMEOUT,
    );

    it(
      "pauses a running Task whose credits fall short, and refuses a finished one",
      () =>
        withWorld(async (world) => {
          stopsOnTheSplitLayout(2);
          const payer = await world.person("short person", 0n);
          const running = await world.task(payer, "short person's Task");
          const finished = await world.task(
            payer,
            "short person's finished Task",
            "COMPLETED",
          );
          const agent = await world.x402Agent("Agent", "Mainnet");
          outside.payX402.mockImplementation((request) =>
            agent.signed(request),
          );

          const paused = await observe(loaded, world, () =>
            pay(loaded, world, running, agent.pay("short")),
          );
          const finishedTask = await observe(loaded, world, () =>
            pay(loaded, world, finished, agent.pay("short, finished")),
          );

          expectStepsAsOnBase(key("an insufficient balance"), {
            paused,
            finishedTask,
          });
        }),
      CASE_TIMEOUT,
    );

    // Not on the split layout: there no request reaches the charge.
    it.skipIf(onSplitLayout).each(["first", "second"] as const)(
      "lets one of two payments spend the same credits when the %s commits first",
      (winner) =>
        withWorld(async (world) => {
          // Three credits: one payment of two fits, two do not.
          const payer = await world.person(
            `racing person, ${winner} first`,
            2n,
          );
          const second = {
            ...payer,
            projectId: (
              await loaded.prisma.project.create({
                data: {
                  workspaceId: payer.workspaceId,
                  name: `second racing Project ${randomUUID()}`,
                },
                select: { id: true },
              })
            ).id,
          };
          world.made.projectIds.push(second.projectId);
          world.labels.set(second.projectId, "<second racing Project>");
          const tasks = {
            first: await world.task(
              payer,
              `first racing Task, ${winner} first`,
            ),
            second: await world.task(
              second,
              `second racing Task, ${winner} first`,
            ),
          };
          const projects = { first: payer.projectId, second: second.projectId };
          const agent = await world.x402Agent("Agent", "Mainnet");
          outside.payX402.mockImplementation((request) =>
            agent.signed(request),
          );
          const loser = winner === "first" ? "second" : "first";
          const gates = Object.fromEntries(
            (["first", "second"] as const).map((name) => {
              let reached = () => {};
              let release = () => {};
              const atGate = new Promise<void>((resolve) => {
                reached = resolve;
              });
              const released = new Promise<void>((resolve) => {
                release = resolve;
              });
              outside.held.set(projects[name], { reached, release: released });
              return [name, { atGate, release }];
            }),
          ) as Record<
            "first" | "second",
            { atGate: Promise<void>; release: () => void }
          >;
          const bodies = {
            first: agent.pay(`first racing, ${winner} first`),
            second: agent.pay(`second racing, ${winner} first`),
          };

          base.expectAsOnBase(
            key(`two payments, the ${winner} commits first`),
            await observe(
              loaded,
              world,
              async () => {
                const keyLock = await lockCoworkerKeyUse(world);
                const answers = {
                  first: pay(loaded, world, tasks.first, bodies.first),
                  second: pay(loaded, world, tasks.second, bodies.second),
                };
                try {
                  // Both have chosen the same buckets and written their debit,
                  // or one ended before it: then the comparison shows that.
                  await Promise.all(
                    (["first", "second"] as const).map((name) =>
                      Promise.race([gates[name].atGate, answers[name]]),
                    ),
                  );
                  gates[winner].release();
                  const won = await answers[winner];
                  gates[loser].release();
                  return { [winner]: won, [loser]: await answers[loser] };
                } finally {
                  // Nothing stays held or running past the case's cleanup.
                  gates.first.release();
                  gates.second.release();
                  outside.held.clear();
                  await keyLock.end();
                  await Promise.allSettled([answers.first, answers.second]);
                }
              },
              { interleaved: true },
            ),
          );
        }),
      CASE_TIMEOUT,
    );
  },
);
