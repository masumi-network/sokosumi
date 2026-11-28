/**
 * The hire's lookup (`requireAgentForHire`), on a real PostgreSQL at the
 * hire's entry point `createAgentJobForUser`, which the Agent hire, the Task
 * hire and the Soko Bot decision apply call: the answer (a Job, or the 400,
 * 404 or 422), the price in cents the debit took, the V2 source the purchase
 * names, the seller and purchase calls in their order, the Agent's
 * `jobCount` and `updatedAt` against the Job's `createdAt`, and every
 * statement PostgreSQL received, with each transaction's boundaries.
 *
 * The lookup's own statements are kept apart (`lookup`), each with its
 * bindings, rates, readiness and the Agent's row in the order sent: they end where the
 * hire prices the Agent it read. Its rates, readiness and Agent reads are
 * separate autocommit statements, with no BEGIN: the one-operation Repeatable
 * Read batch Prisma sends as a plain read. That is `origin/main`'s, kept here
 * on purpose (a real snapshot is a follow-up).
 *
 * Compared with `hire.base.json`, which this file wrote while it ran on
 * `origin/main`'s code, before the lookup moved into the catalog, on today's
 * layout with the deployment `NETWORK` Mainnet and Preprod:
 * RECORD_AGENT_HIRE_BASE=true RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/lib/agent-catalog/hire.postgres.test.ts
 *
 * On the split layout `origin/main` stops at its rate read, through the shared
 * client. There the lookup is compared with today's recording, schema names
 * written as today's; what follows it (the balance read and the Job's
 * transaction, tickets 25 and 27) does not run on that layout yet.
 *
 * Only what leaves Core is stubbed: the seller, the purchase registration and
 * the alert. The fixture runs on a private copy of the database, so the
 * catalog it reads holds only its own rows.
 */
import "@hono/zod-openapi";
import { readFileSync, writeFileSync } from "node:fs";
import type { Pool } from "pg";
import { afterAll, expect, it, vi } from "vitest";
import { expectCoreLog } from "@/test/core-log";
import { copyPostgresTestDatabase } from "@/test/postgres-database-copy";
import { observing, statements } from "@/test/spend-comparison";
import { onSplitLayout } from "@/test/split-layout";

const state = vi.hoisted(() => ({
  network: "Mainnet" as "Mainnet" | "Preprod",
  pools: [] as Pool[],
  useNode: false,
  /** Statements every pool sent, counted while a hire runs. */
  sent: 0,
  /** Each statement's send and its answer, numbered by `sent`. */
  trace: [] as Array<{ seq: number; text: string; phase: "sent" | "done" }>,
  /** `sent` when the hire priced the Agent it read: where the lookup ends. */
  priced: undefined as number | undefined,
  calls: [] as Array<{ call: string; with: unknown }>,
  /** The payment source index the seller answers with. */
  sellerSourceIndex: undefined as number | undefined,
}));

vi.mock("@/config/env", async (load) => {
  const actual = await load<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), NETWORK: state.network }),
  };
});
vi.mock("@vercel/functions", async (load) => {
  const actual = await load<typeof import("@vercel/functions")>();
  const { observePool } = await import("@/test/spend-comparison");
  return {
    ...actual,
    attachDatabasePool: (pool: Pool) => {
      state.pools.push(pool);
      observePool(pool);
      pool.on("connect", (client) => {
        const query = client.query.bind(client) as (...a: unknown[]) => unknown;
        (client as { query: unknown }).query = (...args: unknown[]) => {
          state.sent += 1;
          const seq = state.sent;
          const [first] = args;
          const text =
            typeof first === "string"
              ? first
              : (first as { text: string }).text;
          state.trace.push({ seq, text, phase: "sent" });
          const answered = () => state.trace.push({ seq, text, phase: "done" });
          // The pool's own reads answer through a callback, a client's
          // through the promise; either way the caller's code runs after
          // `answered`.
          const last = args.length - 1;
          const callback = args[last];
          if (typeof callback === "function") {
            args[last] = (...answer: unknown[]) => {
              answered();
              return callback(...answer);
            };
            return query(...args);
          }
          const result = query(...args);
          if (result instanceof Promise) result.then(answered, () => undefined);
          return result;
        };
      });
      actual.attachDatabasePool(pool);
    },
  };
});
// The real price; the call marks the end of the lookup's reads.
vi.mock("@/helpers/agent-cost", async (load) => {
  const actual = await load<typeof import("@/helpers/agent-cost")>();
  return {
    ...actual,
    getAgentCost: (...args: Parameters<typeof actual.getAgentCost>) => {
      state.priced ??= state.sent;
      return actual.getAgentCost(...args);
    },
  };
});
vi.mock("@sokosumi/masumi", async (load) => {
  const actual = await load<typeof import("@sokosumi/masumi")>();
  const { ok } = await import("neverthrow");
  return {
    ...actual,
    createAgentClient: () => ({
      startPaidAgentJob: async (
        agent: { blockchainIdentifier: string },
        identifierFromPurchaser: string,
      ) => {
        state.calls.push({ call: "startPaidAgentJob", with: agent });
        return ok({
          id: "seller-job",
          input_hash: "input-hash",
          identifierFromPurchaser,
          blockchainIdentifier: "purchase-chain",
          payByTime: 1_775_737_949_000,
          submitResultTime: 1_775_755_949_000,
          unlockTime: 1_775_773_949_000,
          externalDisputeUnlockTime: 1_775_784_749_000,
          agentIdentifier: agent.blockchainIdentifier,
          sellerVKey: "seller-vkey",
          ...(state.sellerSourceIndex !== undefined && {
            paymentSourceType: "Web3CardanoV2",
            supportedPaymentSourceIndex: state.sellerSourceIndex,
          }),
        });
      },
      startFreeAgentJob: async (agent: unknown) => {
        state.calls.push({ call: "startFreeAgentJob", with: agent });
        return ok({ id: "free-seller-job" });
      },
    }),
  };
});
vi.mock("uuid", async (load) => {
  const actual = await load<typeof import("uuid")>();
  return {
    ...actual,
    v4: () =>
      state.useNode ? "bb000000-0000-4000-a000-000000000000" : actual.v4(),
  };
});
vi.mock("@/helpers/job-purchase-registration", async (load) => {
  const actual =
    await load<typeof import("@/helpers/job-purchase-registration")>();
  return {
    registerJobPurchase: async (
      input: Parameters<typeof actual.registerJobPurchase>[0],
    ) => {
      if (state.useNode) return actual.registerJobPurchase(input);
      state.calls.push({ call: "registerJobPurchase", with: input });
    },
  };
});
vi.mock("@/helpers/billing-notifications", async (load) => ({
  ...(await load<typeof import("@/helpers/billing-notifications")>()),
  notifyLowBalanceAfterCharge: async (input: unknown) => {
    state.calls.push({ call: "notifyLowBalanceAfterCharge", with: input });
  },
}));

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const recording = process.env.RECORD_AGENT_HIRE_BASE === "true";
const basePath = new URL("./hire.base.json", import.meta.url);

let database: Awaited<ReturnType<typeof copyPostgresTestDatabase>> | undefined;

async function prepareDatabase() {
  // Copied before Core builds its pool, so Core only knows the copy.
  const source =
    process.env.POSTGRES_TEST_TEMPLATE_URL ?? process.env.DATABASE_URL;
  if (!source) throw new Error("The hire comparison needs PostgreSQL");
  database = await copyPostgresTestDatabase(source, "catalog_test");
  vi.stubEnv("DATABASE_URL", database.url);
  vi.stubEnv("DATABASE_URL_UNPOOLED", database.url);
}
async function releaseDatabase() {
  try {
    await Promise.all(state.pools.map((pool) => pool.end()));
  } finally {
    vi.unstubAllEnvs();
    await database?.drop();
  }
}

/** Empties the copy's catalog, credits and readiness before each case. */
async function emptyTheCopy() {
  if (!database) throw new Error("No database copy");
  const { Client } = await import("pg");
  const { testSchemaNames } = await import("@/test/split-layout");
  const names = testSchemaNames();
  const network = names.DATABASE_SCHEMA_MAINNET;
  const client = new Client({ connectionString: database.url });
  await client.connect();
  try {
    await client.query(`TRUNCATE "${network}"."Agent", "${network}"."AgentPricing",
      "${network}"."AgentFixedPricing", "${network}"."UnitValue",
      "${network}"."AgentPaymentSource", "${network}"."CreditCost", "${network}"."Transaction",
      "${network}"."credit_bucket", "${names.DATABASE_SCHEMA_SHARED}"."sync_metadata" CASCADE`);
    await client.query(
      `DELETE FROM "${names.DATABASE_SCHEMA_SHARED}"."user" WHERE id = $1`,
      [USER],
    );
  } finally {
    await client.end();
  }
}

if (enabled) {
  await prepareDatabase();
  afterAll(releaseDatabase);
}

const clock = "2026-11-27T12:00:00.000Z";
const agentCreatedAt = "2026-11-25T01:02:03.456Z";
const agentUpdatedAt = "2026-11-26T04:05:06.789Z";
const USER = "hire-user";
const WORKSPACE = "0193a000-0000-7000-8000-000000000001";
/** One credit, in cents; a lovelace costs 10^4 cents. */
const CREDIT = 10n ** 10n;
const ADA = 1_000_000n;
const POLICY = "ab".repeat(28);
const READY_CONTRACT = "addr_test1_ready_contract";
const OTHER_CONTRACT = "addr_test1_other_contract";
const UNRATED_UNIT = "cd".repeat(28);
const SECOND_READY_CONTRACT = "addr_test1_second_ready_contract";
/** A second rated unit, at 10^8 cents per unit. */
const SECOND_UNIT = `${"ef".repeat(28)}74555344`;

const agentSeed = {
  description: "Hire fixture",
  createdAt: agentCreatedAt,
  updatedAt: agentUpdatedAt,
  jobCount: 2,
  lastUptimeCheck: agentCreatedAt,
  uptimeCount: 1,
  uptimeCheckCount: 1,
  apiBaseUrl: "https://agent.example.test",
};

type Rail = "Mainnet" | "Preprod";
/** A V2 source: its index, rail, contract and price in lovelace or a unit. */
function source(
  id: string,
  sourceIndex: number,
  network: Rail,
  address: string,
  amount: bigint,
  unit = "lovelace",
) {
  return {
    id,
    sourceIndex,
    chain: "Cardano",
    network,
    paymentSourceType: "Web3CardanoV2",
    address,
    pricingType: "FIXED" as const,
    createdAt: agentCreatedAt,
    updatedAt: agentCreatedAt,
    amounts: {
      create: {
        id: `${id}-amount`,
        unit,
        amount,
        createdAt: agentCreatedAt,
        updatedAt: agentCreatedAt,
      },
    },
  };
}

async function seed() {
  const { createNetworkScope } = await import("@/lib/db/network-scope");
  const scope = createNetworkScope("mainnet");
  await scope.sharedDb.user.create({
    data: {
      id: USER,
      name: "Hire fixture",
      email: "hire-user@example.test",
      emailVerified: true,
      createdAt: agentCreatedAt,
      updatedAt: agentCreatedAt,
    },
  });
  await scope.sharedDb.workspace.create({
    data: { id: WORKSPACE, userId: USER },
  });
  await scope.sharedDb.syncMetadata.create({
    data: {
      key: "cardano-v2-rail-readiness",
      cursorId: JSON.stringify([
        { policyId: POLICY, smartContractAddress: READY_CONTRACT },
        { policyId: POLICY, smartContractAddress: SECOND_READY_CONTRACT },
      ]),
      lastSyncedAt: agentCreatedAt,
    },
  });
  await scope.netTransaction(async (tx) => {
    await tx.creditCost.create({
      data: {
        id: "hire-rate",
        unit: "lovelace",
        centsPerUnit: 10n ** 4n,
        createdAt: agentCreatedAt,
        updatedAt: agentCreatedAt,
      },
    });
    await tx.creditCost.create({
      data: {
        id: "hire-rate-second",
        unit: SECOND_UNIT,
        centsPerUnit: 10n ** 8n,
        createdAt: agentCreatedAt,
        updatedAt: agentCreatedAt,
      },
    });
    await tx.transaction.create({
      data: {
        id: "hire-grant",
        amount: 100n * CREDIT,
        userId: USER,
        createdAt: agentCreatedAt,
        updatedAt: agentCreatedAt,
        sourceCreditBucket: {
          create: {
            id: "hire-bucket",
            amount: 100n * CREDIT,
            userId: USER,
            expiresAt: "2027-01-01T00:00:00.000Z",
            createdAt: agentCreatedAt,
            updatedAt: agentCreatedAt,
          },
        },
      },
    });
    const fixed = (id: string, amount: bigint) => ({
      create: {
        id: `${id}-pricing`,
        pricingType: "FIXED" as const,
        fixedPricing: {
          create: {
            id: `${id}-fixed`,
            amounts: { create: { id: `${id}-unit`, unit: "lovelace", amount } },
          },
        },
      },
    });
    await tx.agent.create({
      data: {
        ...agentSeed,
        id: "hire-v1",
        name: "hire-v1",
        blockchainIdentifier: "hire-v1",
        isShown: true,
        paymentType: "WEB3_CARDANO_V1",
        pricing: fixed("hire-v1", 3n * ADA),
      },
    });
    await tx.agent.create({
      data: {
        ...agentSeed,
        id: "hire-v1-two-units",
        name: "hire-v1-two-units",
        blockchainIdentifier: "hire-v1-two-units",
        isShown: true,
        paymentType: "WEB3_CARDANO_V1",
        pricing: {
          create: {
            id: "hire-v1-two-units-pricing",
            pricingType: "FIXED",
            fixedPricing: {
              create: {
                id: "hire-v1-two-units-fixed",
                amounts: {
                  create: [
                    {
                      id: "hire-v1-two-units-a",
                      unit: "lovelace",
                      amount: 3n * ADA,
                    },
                    {
                      id: "hire-v1-two-units-b",
                      unit: SECOND_UNIT,
                      amount: 7n,
                    },
                  ],
                },
              },
            },
          },
        },
      },
    });
    await tx.agent.create({
      data: {
        ...agentSeed,
        id: "hire-free",
        name: "hire-free",
        blockchainIdentifier: "hire-free",
        isShown: true,
        paymentType: "NONE",
        pricing: { create: { id: "hire-free-pricing", pricingType: "FREE" } },
      },
    });
    await tx.agent.create({
      data: {
        ...agentSeed,
        id: "hire-hidden",
        name: "hire-hidden",
        blockchainIdentifier: "hire-hidden",
        isShown: false,
        paymentType: "WEB3_CARDANO_V1",
        pricing: fixed("hire-hidden", ADA),
      },
    });
    // Each rail has a ready source and one that is not; the deployment's
    // rail decides which two the hire loads.
    await tx.agent.create({
      data: {
        ...agentSeed,
        id: "hire-v2",
        name: "hire-v2",
        blockchainIdentifier: `${POLICY}0001`,
        isShown: true,
        paymentType: "WEB3_CARDANO_V2",
        pricing: fixed("hire-v2", 5n * ADA),
        paymentSources: {
          create: [
            source("hire-v2-mainnet-other", 0, "Mainnet", OTHER_CONTRACT, ADA),
            source(
              "hire-v2-mainnet-ready",
              1,
              "Mainnet",
              READY_CONTRACT,
              2n * ADA,
            ),
            source(
              "hire-v2-preprod-ready",
              2,
              "Preprod",
              READY_CONTRACT,
              4n * ADA,
            ),
            source("hire-v2-preprod-other", 3, "Preprod", OTHER_CONTRACT, ADA),
            source(
              "hire-v2-mainnet-second",
              4,
              "Mainnet",
              SECOND_READY_CONTRACT,
              3n * ADA,
            ),
            source(
              "hire-v2-preprod-second",
              5,
              "Preprod",
              SECOND_READY_CONTRACT,
              3n * ADA,
            ),
          ],
        },
      },
    });
    await tx.agent.create({
      data: {
        ...agentSeed,
        id: "hire-v2-unrated",
        name: "hire-v2-unrated",
        blockchainIdentifier: `${POLICY}0002`,
        isShown: true,
        paymentType: "WEB3_CARDANO_V2",
        pricing: fixed("hire-v2-unrated", 5n * ADA),
        paymentSources: {
          create: [
            source(
              "hire-v2u-mainnet",
              0,
              "Mainnet",
              READY_CONTRACT,
              ADA,
              UNRATED_UNIT,
            ),
            source(
              "hire-v2u-preprod",
              1,
              "Preprod",
              READY_CONTRACT,
              ADA,
              UNRATED_UNIT,
            ),
          ],
        },
      },
    });
  }, "Fixture conflict");
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** Ids the hire made, `<id n>` in the order they first appear. */
function withMadeIdsNamed(value: unknown, purchaser: string | undefined) {
  let text = JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
  if (purchaser) text = text.replaceAll(purchaser, "<purchaser identifier>");
  const made = new Map<string, string>([[WORKSPACE, "<workspace>"]]);
  text = text.replace(UUID, (id) => {
    if (!made.has(id)) made.set(id, `<id ${made.size}>`);
    return made.get(id) ?? id;
  });
  return JSON.parse(text);
}

interface Hire {
  agentId: string;
  maxAcceptedCents?: bigint;
  /** The source index the seller answers with, per deployment rail. */
  sellerSourceIndex?: Record<Rail, number>;
}

async function observeHire(hire: Hire) {
  const { createAgentJobForUser } = await import("@/helpers/job");
  const { createNetworkScope } = await import("@/lib/db/network-scope");
  const db = createNetworkScope("mainnet").networkDb;
  state.calls = [];
  state.sent = 0;
  state.trace = [];
  state.priced = undefined;
  state.sellerSourceIndex = hire.sellerSourceIndex?.Mainnet;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(clock));
  let observed: Awaited<ReturnType<typeof observing>>;
  try {
    observed = await observing(() =>
      createAgentJobForUser({
        owner: { ownerId: USER, organizationId: null, workspaceId: WORKSPACE },
        creator: { kind: "user", userId: USER },
        agentInput: {
          agentId: hire.agentId,
          inputData: { prompt: "hello" },
          inputSchema: {
            input_data: [{ id: "prompt", type: "string", name: "prompt" }],
          },
          name: "Hire fixture",
          ...(hire.maxAcceptedCents !== undefined && {
            maxAcceptedCents: hire.maxAcceptedCents,
          }),
        },
      }).then((job) => ({ jobId: job.id })),
    );
  } finally {
    vi.useRealTimers();
  }
  const { outcome, log } = observed;
  const lookup = log.slice(0, state.priced ?? log.length);
  const jobs = await db.job.findMany({
    where: { workspaceId: WORKSPACE },
    select: {
      id: true,
      agentId: true,
      createdAt: true,
      jobType: true,
      paymentSourceType: true,
      supportedPaymentSourceIndex: true,
      purchaseAmounts: true,
      purchaseAmountMatchRequired: true,
      identifierFromPurchaser: true,
    },
  });
  const debits = await db.transaction.findMany({
    where: { userId: USER, amount: { lt: 0n } },
    select: { amount: true, createdAt: true },
  });
  const agent = await db.agent.findUnique({
    where: { id: hire.agentId },
    select: { jobCount: true, updatedAt: true },
  });
  const purchaser = jobs[0]?.identifierFromPurchaser ?? undefined;
  return withMadeIdsNamed(
    {
      outcome,
      outside: state.calls,
      lookup: {
        ...lookupAsSent(lookup),
        dependencies: lookupDependencies(state.priced ?? state.sent),
      },
      statements: statements(log),
      jobs,
      debits,
      agent,
    },
    purchaser,
  );
}

/**
 * Prisma loads a relation of a relation only after the parent's rows are
 * back: the child read is sent after the parent read answered. Siblings may
 * interleave. For each pair of the lookup, whether that held, as on
 * `origin/main`. A read is named by the table its SELECT starts with.
 */
const RELATION_DEPENDENCIES = [
  ["AgentPricing", "AgentFixedPricing"],
  ["AgentFixedPricing", "UnitValue"],
  ["AgentPaymentSource", "AgentPaymentSourceAmount"],
] as const;

/** Rates, then readiness, then the Agent's row, then its relations. */
const LOOKUP_SEQUENCE = [
  ["CreditCost", "sync_metadata"],
  ["sync_metadata", "Agent"],
  ["Agent", "AgentPricing"],
  ["Agent", "AgentMetadataOverride"],
  ["Agent", "AgentPaymentSource"],
] as const;

function lookupDependencies(lastLookupSeq: number) {
  const events = state.trace.filter((event) => event.seq <= lastLookupSeq);
  const first = (table: string, phase: "sent" | "done") =>
    events.findIndex(
      (event) =>
        event.phase === phase &&
        /^SELECT "[^"]+"\."([^"]+)"\./.exec(event.text)?.[1] === table,
    );
  // The lookup's own sequence, as on `origin/main`: each read is sent only
  // after the one it follows answered. Checked whenever the later read ran.
  for (const [parent, child] of LOOKUP_SEQUENCE) {
    const childSent = first(child, "sent");
    if (childSent === -1) continue;
    const parentDone = first(parent, "done");
    expect(
      parentDone,
      `${parent} must answer before ${child} is sent`,
    ).not.toBe(-1);
    expect(
      parentDone,
      `${parent} must answer before ${child} is sent`,
    ).toBeLessThan(childSent);
  }
  return RELATION_DEPENDENCIES.map(([parent, child]) => {
    const parentDone = first(parent, "done");
    const childSent = first(child, "sent");
    return {
      parent,
      child,
      childSentAfterParentAnswered:
        parentDone === -1 || childSent === -1 ? null : parentDone < childSent,
    };
  });
}

/**
 * The lookup's statements with their bindings. Rates, readiness and the
 * Agent's own row are read one after the other: kept in the order sent.
 * Prisma then loads the Agent's relations, some side by side on other
 * connections: kept as the set they are, each with its bindings. Schema names
 * are written as today's layout names them.
 */
function lookupAsSent(lookup: Parameters<typeof statements>[0]) {
  const sent = statements(lookup, { asSent: true });
  const today = (sql: string) =>
    sql.replace(/"(shared|mainnet)"\./g, '"public".');
  const plainSql = (statement: { sql: string; values: unknown[] }) => ({
    sql: today(statement.sql),
    values: statement.values,
  });
  const outside = sent.outsideTransactions.map(plainSql);
  return {
    transactions: sent.transactions.map((tx) => tx.map(plainSql)),
    inOrder: outside.slice(0, 3),
    relations: outside
      .slice(3)
      .map((statement) =>
        JSON.stringify(statement, (_key, item) =>
          typeof item === "bigint" ? item.toString() : item,
        ),
      )
      .sort()
      .map((statement) => JSON.parse(statement)),
  };
}

const cases: Array<[string, Hire]> = [
  ["a V1 hire in two rated units", { agentId: "hire-v1-two-units" }],
  [
    "a V2 hire, the seller naming the second ready source",
    { agentId: "hire-v2", sellerSourceIndex: { Mainnet: 4, Preprod: 5 } },
  ],
  [
    "a V1 hire at its cap",
    { agentId: "hire-v1", maxAcceptedCents: 3n * CREDIT },
  ],
  [
    "a V1 hire over its cap",
    { agentId: "hire-v1", maxAcceptedCents: 3n * CREDIT - 1n },
  ],
  ["a free hire", { agentId: "hire-free" }],
  ["a hidden Agent", { agentId: "hire-hidden" }],
  ["an unknown Agent", { agentId: "hire-missing" }],
  [
    "a V2 hire, the seller naming the ready source",
    { agentId: "hire-v2", sellerSourceIndex: { Mainnet: 1, Preprod: 2 } },
  ],
  [
    "a V2 hire, the seller naming a source that is not ready",
    { agentId: "hire-v2", sellerSourceIndex: { Mainnet: 0, Preprod: 3 } },
  ],
  [
    "a V2 hire over its explicit cap",
    {
      agentId: "hire-v2",
      maxAcceptedCents: CREDIT,
      sellerSourceIndex: { Mainnet: 1, Preprod: 2 },
    },
  ],
  ["a V2 Agent whose ready source has no rate", { agentId: "hire-v2-unrated" }],
];

it.skipIf(!enabled).each(["Mainnet", "Preprod"] as const)(
  "the hire's lookup answers as on origin/main with deployment NETWORK=%s",
  async (network) => {
    state.network = network;
    const recorded: Record<string, unknown> = {};
    for (const [name, hire] of cases) {
      // Each case on the same seed: the Job and the debit of one case do not
      // reach the next.
      await emptyTheCopy();
      await seed();
      recorded[`Mainnet: ${name}`] = await observeHire(hire);
    }
    // The seller started a Job on a source that was not ready.
    expectCoreLog(
      "error",
      "A seller started a job that Sokosumi will not track",
    );
    const base = existsBase();
    if (recording) {
      expect(onSplitLayout).toBe(false);
      writeFileSync(
        basePath,
        `${JSON.stringify({ ...base, ...recorded }, null, 2)}\n`,
      );
      return;
    }
    if (!onSplitLayout) {
      for (const [key, observed] of Object.entries(recorded))
        expect(observed, key).toEqual(base[key]);
      return;
    }
    // Split layout: the lookup as on today's layout, and a case the lookup
    // ends answers as it did there.
    for (const [key, observed] of Object.entries(recorded)) {
      const now = observed as { lookup: unknown; outcome: unknown };
      const then = base[key] as typeof now & {
        statements: { transactions: unknown[] };
        outside: unknown[];
      };
      expect(now.lookup, key).toEqual(then.lookup);
      const endedInTheLookup =
        then.outside.length === 0 && then.statements.transactions.length === 0;
      if (endedInTheLookup) expect(now.outcome, key).toEqual(then.outcome);
    }
  },
  180_000,
);

function existsBase(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(basePath, "utf8"));
  } catch (error) {
    if (recording) return {};
    throw error;
  }
}

it.skipIf(!enabled)(
  "sends the same Mainnet free hire, paid hire and refund requests",
  async () => {
    state.network = "Mainnet";
    await emptyTheCopy();
    await seed();
    const { createApiKey, createCoreApp } = await import(
      "@/test-fixtures/core-session"
    );
    const { stubMasumiSyncHttp } = await import("@/test/masumi-sync-http");
    const app = createCoreApp();
    const headers = {
      authorization: "Bearer " + (await createApiKey(USER)),
      "content-type": "application/json",
    };
    const node = stubMasumiSyncHttp();
    state.useNode = true;
    try {
      const hire = (id: string) =>
        app.request("https://example.com/v1/agents/" + id + "/jobs", {
          method: "POST",
          headers,
          body: JSON.stringify({
            inputSchema: {
              input_data: [{ name: "prompt", id: "prompt", type: "string" }],
            },
            inputData: { prompt: "hello" },
          }),
        });
      if (onSplitLayout) {
        // The two hires still fail with P2021 on shared.Job until slice 25-4;
        // refund's requireJobCollaboration now reads mainnet."Job" and rejects
        // the missing fixture job with 403 before reaching tx.job.findUnique.
        expectCoreLog(
          "error",
          "Kept a database schema mismatch out of Sentry",
          2,
        );
        const statuses = [
          (await hire("hire-free")).status,
          (await hire("hire-v1")).status,
          (
            await app.request(
              "https://example.com/v1/jobs/fixture-paid-job/refund",
              { method: "POST", headers },
            )
          ).status,
        ];
        expect(statuses).toEqual([500, 500, 403]);
        expect(node.requests).toEqual([]);
        return;
      }
      expect((await hire("hire-free")).status).toBe(201);
      expect(node.requests).toHaveLength(0);
      const paid = await hire("hire-v1");
      expect(paid.status).toBe(201);
      const job = (await paid.json()).data;
      const refund = await app.request(
        "https://example.com/v1/jobs/" + job.id + "/refund",
        { method: "POST", headers },
      );
      expect(refund.status).toBe(200);
      expect(node.requests).toHaveLength(2);
      await expect(
        JSON.stringify(node.requests, null, 2) + "\n",
      ).toMatchFileSnapshot("./masumi-mainnet-jobs.http.json");
    } finally {
      state.useNode = false;
      vi.unstubAllGlobals();
    }
  },
  60_000,
);
