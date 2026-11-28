/**
 * Slice 25-3: Job writes that move no money, shared Task move Job update,
 * and refusal of Preprod Job shares.
 *
 * Covers:
 * - Mainnet parity pinned against origin/main (`writes.base.json`) for no header
 *   and `mainnet` header across all 122 cases: statuses, normalized bodies,
 *   all-column Job rows (including `agentApiBaseUrl` and exact timestamps),
 *   seller calls, calendar invalidations, exact SQL + bound values + statement
 *   order + transaction boundaries (zero Mainnet changes on today's layout).
 * - Bounded read transaction in `POST /v1/jobs/:id/inputs`: holding `jobEvent`
 *   for 6.3s times out with 500, 0 seller calls, and 0 inserted inputs.
 * - `PUT /v1/jobs/:id/workspace` in-transaction readback: creator deleted
 *   between Job read and its relations, concurrent rename (update & no-op),
 *   concurrent second move, and concurrent Job delete all match origin/main
 *   (200 with the transaction's own snapshot).
 * - Preprod off (today's layout): 403 `preprod_off` with zero Network table
 *   locks (`EXPLAIN` + `pg_locks`) and zero seller calls on all 4 moved Job
 *   writes (rename stays on Mainnet until slice 25-3b); 422
 *   `mainnet_only_feature` on PUT & DELETE `/v1/jobs/:id/share`.
 * - Preprod on (split layout): equal-id isolation across `mainnet` and
 *   `preprod`, whole-row before/after assertions on all 4 moved Job writes and
 *   `moveTaskJobs`, per-Network seller dispatch, parked-Task & work-right
 *   checks, full split-tx Job detail readback (events, inputs, blobs, links,
 *   purchase, transactions, override, share), and 422 share refusal.
 * - `updatedAt` UTC clock pin on raw SQL updates vs Prisma `@updatedAt`.
 * - Gated races: two-movers on `PUT /v1/jobs/:id/workspace`, and ticket 26
 *   deletion interleavings (personal workspace, organization, user, project,
 *   task archive) in both orders through explicit gates.
 */
import "@hono/zod-openapi";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { Prisma } from "@sokosumi/database";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { err, ok } from "neverthrow";
import { Client, type Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { expectCoreLog } from "@/test/core-log";
import { copyPostgresTestDatabase } from "@/test/postgres-database-copy";
import {
  holdCommit,
  inFlow,
  nextMillisecond,
  observePool,
  observing,
} from "@/test/spend-comparison";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor";
import tableLayout from "../../../../../../packages/database/prisma/network-tables.json";

const pools = vi.hoisted(() => [] as Pool[]);
const sellerCalls = vi.hoisted(
  () =>
    [] as {
      agent: {
        id: string;
        name: string;
        blockchainIdentifier: string;
        apiBaseUrl: string;
      };
      agentJobId: string;
      inputSchema: string;
      inputData: Record<string, unknown>;
    }[],
);
const sellerOutcome = vi.hoisted(() => ({
  next: null as null | { err: string },
}));
const publishedInvalidations = vi.hoisted(() => [] as string[]);
const queryGate = vi.hoisted(() => ({
  active: null as null | {
    when: "before" | "after";
    match: (text: string, values: unknown[]) => boolean;
    run: () => Promise<void>;
  },
}));
const coreErrors = vi.hoisted(() => [] as unknown[]);

vi.unmock("@/lib/db/prisma");
vi.mock("@vercel/functions", async (load) => {
  const actual = await load<typeof import("@vercel/functions")>();
  return {
    ...actual,
    attachDatabasePool: (pool: Pool) => {
      pools.push(pool);
      observePool(pool);
      pool.on("connect", (client: PoolClient) => {
        const inner = client.query.bind(client) as (...a: unknown[]) => unknown;
        (client as { query: unknown }).query = (...args: unknown[]) => {
          const gate = queryGate.active;
          if (!gate || typeof args.at(-1) === "function") {
            return inner(...args);
          }
          const [first, second] = args;
          const text =
            typeof first === "string"
              ? first
              : (first as { text: string }).text;
          const values =
            typeof first === "string"
              ? Array.isArray(second)
                ? second
                : []
              : Array.isArray((first as { values?: unknown }).values)
                ? ((first as { values: unknown[] }).values ?? [])
                : [];
          if (!gate.match(text, values)) {
            return inner(...args);
          }
          queryGate.active = null;
          if (gate.when === "before") {
            return gate.run().then(() => inner(...args));
          }
          return Promise.resolve(inner(...args)).then(async (res) => {
            await gate.run();
            return res;
          });
        };
      });
    },
  };
});
vi.mock("@sokosumi/masumi", async (load) => {
  const actual = await load<typeof import("@sokosumi/masumi")>();
  return {
    ...actual,
    createAgentClient: () => ({
      ...actual.createAgentClient(),
      provideJobInput: async (
        agent: {
          id: string;
          name: string;
          blockchainIdentifier: string;
          apiBaseUrl: string;
        },
        agentJobId: string,
        inputSchema: string,
        inputData: Record<string, unknown>,
      ) => {
        sellerCalls.push({ agent, agentJobId, inputSchema, inputData });
        if (sellerOutcome.next) {
          const failure = sellerOutcome.next.err;
          sellerOutcome.next = null;
          return err({ kind: "unreachable", message: failure });
        }
        return ok({
          input_hash: `hash:${agent.apiBaseUrl}:${agentJobId}`,
          signature: `sig:${agent.apiBaseUrl}:${agentJobId}`,
        });
      },
    }),
  };
});
vi.mock("@/helpers/calendar-invalidation", async (load) => {
  const actual = await load<typeof import("@/helpers/calendar-invalidation")>();
  return {
    ...actual,
    deliverCalendarInvalidationsNow: vi.fn(async (workspaceId: string) => {
      publishedInvalidations.push(workspaceId);
    }),
  };
});
vi.mock("@/lib/evlog", async (load) => {
  const actual = await load<typeof import("@/lib/evlog")>();
  return {
    ...actual,
    recordCoreError: (...args: Parameters<typeof actual.recordCoreError>) => {
      coreErrors.push(args);
      return actual.recordCoreError(...args);
    },
  };
});

const BASE_DATABASE_URL =
  process.env.POSTGRES_TEST_TEMPLATE_URL ?? process.env.DATABASE_URL;
const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const recording = process.env.RECORD_JOB_WRITES_BASE === "true";
const rawTracePath = process.env.JOB_WRITES_RAW_PATH;
const raceTracePath = process.env.JOB_WRITES_RACE_PATH;
const basePath = new URL("./writes.base.json", import.meta.url);

const CLOCK = new Date("2026-11-28T10:00:00.000Z");
const WRITE_CLOCK = new Date("2026-11-28T10:05:00.000Z");

const OWNER_ID = "jw-owner";
const ADMIN_ID = "jw-admin";
const MEMBER_ID = "jw-member";
const UNSEATED_ID = "jw-unseated";
const OUTSIDER_ID = "jw-outsider";

const ORG_A_ID = "jw-org-a";
const ORG_B_ID = "jw-org-b";
const WS_ORG_A = "25300000-0000-4000-8000-000000000001";
const WS_ORG_B = "25300000-0000-4000-8000-000000000002";
const WS_PERSONAL = "25300000-0000-4000-8000-000000000003";
const WS_OUTSIDER = "25300000-0000-4000-8000-000000000004";

const PROJ_A1 = "25300000-0000-4000-8000-000000000011";
const PROJ_A2 = "25300000-0000-4000-8000-000000000012";
const PROJ_CMO = "25300000-0000-4000-8000-000000000013";

const VENDOR_A = "25300000-0000-4000-8000-000000000021";
const BOT_PERSONAL = "25300000-0000-4000-8000-000000000031";
const BOT_CMO = "25300000-0000-4000-8000-000000000032";

const CW_ASSIGNED = "jw-cw-assigned";
const CW_OTHER = "jw-cw-other";
const CW_NOCAP = "jw-cw-nocap";

const AGENT_ID = "jw-agent";

const TASK_PUBLIC = "jw-task-public";
const TASK_PRIVATE = "jw-task-private";
const TASK_PARKED = "jw-task-parked";
const TASK_ARCHIVED = "jw-task-archived";
const TASK_BOT = "jw-task-bot";
const TASK_MOVABLE = "jw-task-movable";
const TASK_PRIVATE_MOVABLE = "jw-task-private-movable";
const TASK_LINKED_A = "jw-task-linked-a";
const TASK_LINKED_B = "jw-task-linked-b";

const JOB_STANDALONE = "jw-job-standalone";
const JOB_WITH_PROJECT = "jw-job-with-project";
const JOB_CMO_PROJECT = "jw-job-cmo-project";
const JOB_NO_OWNER = "jw-job-no-owner";
const JOB_NO_OWNER_MOVE = "jw-job-no-owner-move";
const JOB_PUBLIC_TASK = "jw-job-public-task";
const JOB_PRIVATE_TASK = "jw-job-private-task";
const JOB_PARKED_TASK = "jw-job-parked-task";
const JOB_ARCHIVED_TASK = "jw-job-archived-task";
const JOB_BOT_TASK = "jw-job-bot-task";
const JOB_MOVABLE_TASK = "jw-job-movable-task";
const JOB_MOVE_PERSONAL = "jw-job-move-personal";
const JOB_SHARE_TARGET = "jw-job-share-target";

const auth = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});
const preprodAuth = (id: string): Record<string, string> =>
  auth(`soko_preprod_${id}`);
const ORG_A = { "X-Organization-Slug": ORG_A_ID };
const OWNER_ORG_A = { ...auth(OWNER_ID), ...ORG_A };
const ADMIN_ORG_A = { ...auth(ADMIN_ID), ...ORG_A };
const MEMBER_ORG_A = { ...auth(MEMBER_ID), ...ORG_A };
const PP_OWNER_ORG_A = { ...preprodAuth(OWNER_ID), ...ORG_A };
const PP_ADMIN_ORG_A = { ...preprodAuth(ADMIN_ID), ...ORG_A };
const PP_MEMBER_ORG_A = { ...preprodAuth(MEMBER_ID), ...ORG_A };
const OUTSIDER_HDR = auth(OUTSIDER_ID);
const CW_ASSIGNED_HDR = {
  ...auth(`coworker_${CW_ASSIGNED}`),
  "X-Context-User-Id": OWNER_ID,
  "X-Context-Organization-Id": ORG_A_ID,
};
const CW_OTHER_HDR = {
  ...auth(`coworker_${CW_OTHER}`),
  "X-Context-User-Id": OWNER_ID,
  "X-Context-Organization-Id": ORG_A_ID,
};
const CW_NOCAP_HDR = {
  ...auth(`coworker_${CW_NOCAP}`),
  "X-Context-User-Id": OWNER_ID,
  "X-Context-Organization-Id": ORG_A_ID,
};
const CW_BARE_HDR = auth(`coworker_${CW_ASSIGNED}`);
const BOT_HDR = auth("sokoBot_jw_personal");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatPgTimestampUtc(date: Date): string {
  const iso = date.toISOString();
  const frac = iso.slice(19, 23) === ".000" ? "" : iso.slice(19, 23);
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}${frac}`;
}

/**
 * Replaces ONLY the explicitly verified generated identities (UUIDv7/UUIDv4
 * IDs and share tokens minted during the pass). Fixed-clock timestamps, other
 * UUIDs, and every other bind/row/body value are compared literally.
 */
function mapGeneratedIdentities(
  value: unknown,
  replacements: ReadonlyMap<string, string>,
): string {
  let serialized = JSON.stringify(value, (_key, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  for (const [actual, placeholder] of replacements) {
    serialized = serialized.replaceAll(actual, placeholder);
  }
  return serialized;
}

function assertJobInputWrite(params: {
  label: string;
  schema: string;
  res: {
    status: number;
    body: string;
    statements: { text: string; values: unknown[] }[];
  };
  expectedEventId: string;
  expectedInputData: Record<string, unknown>;
  expectedClock: Date;
  storedRows: Record<string, unknown>[];
}): string {
  const {
    label,
    schema,
    res,
    expectedEventId,
    expectedInputData,
    expectedClock,
    storedRows,
  } = params;
  expect(res.status, `${label}: ${res.body}`).toBe(201);
  const created = (
    JSON.parse(res.body) as {
      data: {
        id: string;
        input: string;
        inputHash: string | null;
        signature: string | null;
      };
    }
  ).data;
  expect(created.id, `${label} generated id`).toMatch(UUID_RE);

  const expectedPgTs = formatPgTimestampUtc(expectedClock);
  const expectedInputJson = JSON.stringify(expectedInputData);

  const insertStmts = res.statements.filter((stmt) =>
    stmt.text.includes(`INSERT INTO "${schema}"."jobInput"`),
  );
  expect(insertStmts, `${label} INSERT jobInput count`).toHaveLength(1);
  expect(
    insertStmts[0]?.values,
    `${label} literal INSERT jobInput binds`,
  ).toEqual([
    created.id,
    expectedPgTs,
    expectedPgTs,
    expectedEventId,
    expectedInputJson,
    created.inputHash,
    created.signature,
  ]);

  const selectByIdStmts = res.statements.filter(
    (stmt) =>
      stmt.text.includes(`FROM "${schema}"."jobInput"`) &&
      stmt.text.includes(`"${schema}"."jobInput"."id" = $1`),
  );
  expect(selectByIdStmts, `${label} SELECT jobInput by id count`).toHaveLength(
    1,
  );
  expect(
    selectByIdStmts[0]?.values[0],
    `${label} SELECT jobInput id bind`,
  ).toBe(created.id);

  const stored = storedRows.find((row) => row.eventId === expectedEventId);
  expect(stored, `${label} stored jobInput row`).toBeDefined();
  expect(
    {
      id: stored?.id,
      eventId: stored?.eventId,
      input: stored?.input,
      inputHash: stored?.inputHash,
      signature: stored?.signature,
      createdAt:
        stored?.createdAt instanceof Date
          ? stored.createdAt.toISOString()
          : stored?.createdAt,
      updatedAt:
        stored?.updatedAt instanceof Date
          ? stored.updatedAt.toISOString()
          : stored?.updatedAt,
    },
    `${label} complete stored jobInput row`,
  ).toEqual({
    id: created.id,
    eventId: expectedEventId,
    input: expectedInputJson,
    inputHash: created.inputHash,
    signature: created.signature,
    createdAt: expectedClock.toISOString(),
    updatedAt: expectedClock.toISOString(),
  });

  return created.id;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function buildWorld(options: { preprodOn?: boolean } = {}) {
  const source = BASE_DATABASE_URL;
  if (!source) throw new Error("Job writes test requires PostgreSQL");
  const database = await copyPostgresTestDatabase(source, "job_writes_test");
  (globalThis as { coreDatabase?: unknown }).coreDatabase = undefined;
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", database.url);
  vi.stubEnv("DATABASE_URL_UNPOOLED", database.url);
  vi.stubEnv("NETWORK", "Mainnet");
  vi.stubEnv("NETWORK_PREPROD_ENABLED", options.preprodOn ? "true" : "false");

  const poolsBefore = pools.length;
  const { default: shared } = await import("@/lib/db/prisma");
  const { createNetworkScope } = await import("@/lib/db/network-scope");
  const { serializableTransaction } = await import("@/lib/db/transaction");
  const { moveTaskJobs } = await import("@/routes/v1/tasks/[id]/workspace/put");
  const { deletePersonalWorkspace } = await import(
    "@/helpers/personal-workspace"
  );
  const { prepareOrganizationForDeletion } = await import(
    "@/helpers/organization-deletion"
  );
  const { prepareTasksForUserDeletion } = await import(
    "@/helpers/user-deletion-tasks"
  );
  const { createCoreApp } = await import("@/test-fixtures/core-session");
  const { hashApiKey } = await import("@/lib/coworker-api-key");
  const { CMO_SOKO_BOT_VERSION_ID } = await import("@sokosumi/soko-bot");

  for (const [id, wsId] of [
    [OWNER_ID, WS_PERSONAL],
    [ADMIN_ID, null],
    [MEMBER_ID, null],
    [UNSEATED_ID, null],
    [OUTSIDER_ID, WS_OUTSIDER],
  ] as const) {
    await shared.user.create({
      data: {
        id,
        name: id,
        email: `${id}@example.test`,
        emailVerified: true,
        termsAccepted: true,
        preprodEnabled: id === OWNER_ID,
        createdAt: CLOCK,
        updatedAt: CLOCK,
        ...(wsId ? { workspace: { create: { id: wsId } } } : {}),
      },
    });
    await shared.apikey.create({
      data: {
        id,
        referenceId: id,
        key: createHash("sha256").update(id).digest("base64url"),
        enabled: true,
        rateLimitEnabled: false,
        createdAt: CLOCK,
        updatedAt: CLOCK,
      },
    });
    if (options.preprodOn) {
      const ppKey = `soko_preprod_${id}`;
      await shared.apikey.create({
        data: {
          id: `pp-${id}`,
          referenceId: id,
          prefix: "soko_preprod_",
          start: ppKey.slice(0, 19),
          key: createHash("sha256").update(ppKey).digest("base64url"),
          enabled: true,
          rateLimitEnabled: false,
          createdAt: CLOCK,
          updatedAt: CLOCK,
        },
      });
    }
  }

  await shared.organization.create({
    data: {
      id: ORG_A_ID,
      name: "Org A",
      slug: ORG_A_ID,
      preprodEnabled: true,
      createdAt: CLOCK,
      workspace: { create: { id: WS_ORG_A } },
      members: {
        create: [
          {
            id: "jw-m-owner-a",
            userId: OWNER_ID,
            role: "owner",
            seatAssignedAt: CLOCK,
          },
          {
            id: "jw-m-admin-a",
            userId: ADMIN_ID,
            role: "admin",
            seatAssignedAt: CLOCK,
          },
          {
            id: "jw-m-member-a",
            userId: MEMBER_ID,
            role: "member",
            seatAssignedAt: CLOCK,
          },
          {
            id: "jw-m-unseated-a",
            userId: UNSEATED_ID,
            role: "member",
            seatAssignedAt: null,
          },
        ],
      },
    },
  });

  await shared.subscription.create({
    data: {
      id: "jw-sub-org-a",
      plan: "starter",
      referenceId: ORG_A_ID,
      status: "active",
      seats: 5,
    },
  });

  await shared.organization.create({
    data: {
      id: ORG_B_ID,
      name: "Org B",
      slug: ORG_B_ID,
      preprodEnabled: true,
      createdAt: CLOCK,
      workspace: { create: { id: WS_ORG_B } },
      members: {
        create: [
          {
            id: "jw-m-owner-b",
            userId: OWNER_ID,
            role: "member",
            seatAssignedAt: CLOCK,
          },
          {
            id: "jw-m-admin-b",
            userId: ADMIN_ID,
            role: "member",
            seatAssignedAt: CLOCK,
          },
          {
            id: "jw-m-member-b",
            userId: MEMBER_ID,
            role: "member",
            seatAssignedAt: CLOCK,
          },
        ],
      },
    },
  });

  await shared.vendorGrant.createMany({
    data: [WS_ORG_A, WS_ORG_B, WS_PERSONAL, WS_OUTSIDER].map((workspaceId) => ({
      vendorId: TEST_VENDOR_ID,
      workspaceId,
      permission: "workspace",
      status: "GRANTED",
    })),
  });
  await shared.vendor.create({
    data: { id: VENDOR_A, name: "Vendor A", slug: "jw-vendor-a" },
  });
  await shared.vendorGrant.create({
    data: {
      vendorId: VENDOR_A,
      workspaceId: WS_ORG_A,
      permission: "workspace",
      status: "GRANTED",
    },
  });
  for (const [id, capabilities] of [
    [CW_ASSIGNED, ["tasks"]],
    [CW_OTHER, ["tasks"]],
    [CW_NOCAP, []],
  ] as const) {
    await shared.coworker.create({
      data: {
        id,
        name: id,
        slug: id,
        vendorId: VENDOR_A,
        capabilities: [...capabilities],
      },
    });
    const token = `coworker_${id}`;
    await shared.coworkerApiKey.create({
      data: {
        id,
        coworkerId: id,
        keyHash: await hashApiKey(token),
        keyStart: token.slice(0, 12),
        lastUsedAt: CLOCK,
      },
    });
  }

  await shared.project.createMany({
    data: [
      {
        id: PROJ_A1,
        workspaceId: WS_ORG_A,
        name: "Project A1",
        createdAt: CLOCK,
        updatedAt: CLOCK,
      },
      {
        id: PROJ_A2,
        workspaceId: WS_ORG_A,
        name: "Project A2",
        createdAt: CLOCK,
        updatedAt: CLOCK,
      },
      {
        id: PROJ_CMO,
        workspaceId: WS_ORG_A,
        name: "CMO Project",
        createdAt: CLOCK,
        updatedAt: CLOCK,
      },
    ],
  });

  await shared.sokoBot.createMany({
    data: [
      { id: BOT_PERSONAL, userId: OWNER_ID, workspaceId: WS_PERSONAL },
      {
        id: BOT_CMO,
        userId: null,
        workspaceId: WS_ORG_A,
        projectId: PROJ_CMO,
        versionId: CMO_SOKO_BOT_VERSION_ID,
      },
    ],
  });
  const botToken = "sokoBot_jw_personal";
  await shared.coworkerApiKey.create({
    data: {
      id: "jw-bot-key",
      sokoBotId: BOT_PERSONAL,
      keyHash: await hashApiKey(botToken),
      keyStart: botToken.slice(0, 12),
      lastUsedAt: CLOCK,
    },
  });

  await shared.task.createMany({
    data: [
      { id: TASK_PUBLIC, name: "Public Task", assigneeId: CW_ASSIGNED },
      {
        id: TASK_PRIVATE,
        name: "Private Task",
        visibility: "PRIVATE",
        assigneeId: CW_ASSIGNED,
      },
      {
        id: TASK_PARKED,
        name: "Parked Task",
        status: "GRANT_PENDING",
        assigneeId: CW_ASSIGNED,
      },
      {
        id: TASK_ARCHIVED,
        name: "Archived Task",
        archivedAt: CLOCK,
        assigneeId: CW_ASSIGNED,
      },
      {
        id: TASK_BOT,
        name: "Bot Task",
        workspaceId: WS_PERSONAL,
        organizationId: null,
        assigneeSokoBotId: BOT_PERSONAL,
      },
      { id: TASK_MOVABLE, name: "Movable Task", projectId: PROJ_A1 },
      {
        id: TASK_PRIVATE_MOVABLE,
        name: "Private Movable Task",
        visibility: "PRIVATE",
      },
      { id: TASK_LINKED_A, name: "Linked A" },
      { id: TASK_LINKED_B, name: "Linked B" },
    ].map((row) => ({
      ownerId: OWNER_ID,
      organizationId: ORG_A_ID,
      workspaceId: WS_ORG_A,
      status: "READY",
      createdAt: CLOCK,
      updatedAt: CLOCK,
      ...row,
    })) as Prisma.TaskCreateManyInput[],
  });

  await shared.taskLink.create({
    data: {
      id: "jw-task-link-1",
      fromTaskId: TASK_LINKED_A,
      toTaskId: TASK_LINKED_B,
      type: "RELATES",
      createdAt: CLOCK,
      updatedAt: CLOCK,
    },
  });

  async function seedNetwork(network: "mainnet" | "preprod") {
    const { networkDb } = createNetworkScope(network);
    const isPreprod = network === "preprod";
    await networkDb.agent.create({
      data: {
        id: AGENT_ID,
        name: `Agent-${network}`,
        blockchainIdentifier: `chain-${network}`,
        apiBaseUrl: `https://seller.${network}.example.test`,
        isShown: true,
        uptimeCount: 0,
        uptimeCheckCount: 0,
        lastUptimeCheck: CLOCK,
        pricing: {
          create: { id: `${AGENT_ID}-${network}`, pricingType: "FREE" },
        },
      },
    });

    const jobRow = (
      id: string,
      overrides: Partial<Prisma.JobCreateManyInput> = {},
    ): Prisma.JobCreateManyInput => ({
      id,
      ownerId: isPreprod ? MEMBER_ID : OWNER_ID,
      creatorUserId: isPreprod ? OWNER_ID : MEMBER_ID,
      organizationId: ORG_A_ID,
      workspaceId: WS_ORG_A,
      taskId: null,
      projectId: null,
      agentId: AGENT_ID,
      agentJobId: `seller-job-${network}-${id}`,
      agentApiBaseUrl: `https://seller.${network}.example.test`,
      agentBlockchainIdentifier: `chain-${network}`,
      jobType: "FREE",
      name: `${network}:${id}`,
      createdAt: CLOCK,
      updatedAt: CLOCK,
      ...overrides,
    });

    await networkDb.job.createMany({
      data: [
        jobRow(JOB_STANDALONE),
        jobRow(JOB_WITH_PROJECT, { projectId: PROJ_A1 }),
        jobRow(JOB_CMO_PROJECT, { projectId: PROJ_CMO }),
        jobRow(JOB_NO_OWNER, {
          ownerId: null,
          creatorUserId: null,
          creatorSokoBotId: BOT_PERSONAL,
        }),
        jobRow(JOB_NO_OWNER_MOVE, {
          ownerId: null,
          creatorUserId: null,
          creatorSokoBotId: BOT_PERSONAL,
        }),
        jobRow(JOB_PUBLIC_TASK, { taskId: TASK_PUBLIC }),
        jobRow(JOB_PRIVATE_TASK, { taskId: TASK_PRIVATE }),
        jobRow(JOB_PARKED_TASK, { taskId: TASK_PARKED }),
        jobRow(JOB_ARCHIVED_TASK, { taskId: TASK_ARCHIVED }),
        jobRow(JOB_BOT_TASK, {
          workspaceId: WS_PERSONAL,
          organizationId: null,
          taskId: TASK_BOT,
        }),
        jobRow(JOB_MOVABLE_TASK, { taskId: TASK_MOVABLE, projectId: PROJ_A1 }),
        jobRow(JOB_MOVE_PERSONAL, {
          workspaceId: WS_PERSONAL,
          organizationId: null,
        }),
        jobRow(JOB_SHARE_TARGET),
      ],
    });

    for (const id of [
      JOB_STANDALONE,
      JOB_NO_OWNER,
      JOB_PUBLIC_TASK,
      JOB_PARKED_TASK,
      JOB_ARCHIVED_TASK,
      JOB_BOT_TASK,
    ]) {
      await networkDb.jobEvent.create({
        data: {
          id: `evt-await-${id}`,
          jobId: id,
          status: "AWAITING_INPUT",
          inputSchema: '{"input_data":[{"id":"answer","type":"string"}]}',
          createdAt: CLOCK,
          updatedAt: CLOCK,
        },
      });
    }
    await networkDb.jobEvent.create({
      data: {
        id: "evt-noschema",
        jobId: JOB_STANDALONE,
        status: "AWAITING_INPUT",
        inputSchema: null,
        createdAt: CLOCK,
        updatedAt: CLOCK,
      },
    });
    await networkDb.jobEvent.create({
      data: {
        id: "evt-seller-fail",
        jobId: JOB_STANDALONE,
        status: "AWAITING_INPUT",
        inputSchema: '{"input_data":[{"id":"answer","type":"string"}]}',
        createdAt: CLOCK,
        updatedAt: CLOCK,
      },
    });
    await networkDb.jobEvent.create({
      data: {
        id: "evt-answered",
        jobId: JOB_STANDALONE,
        status: "AWAITING_INPUT",
        inputSchema: '{"input_data":[{"id":"answer","type":"string"}]}',
        createdAt: CLOCK,
        updatedAt: CLOCK,
        input: {
          create: {
            id: "inp-already",
            input: '{"answer":"old"}',
            createdAt: CLOCK,
            updatedAt: CLOCK,
          },
        },
      },
    });
  }

  await seedNetwork("mainnet");
  if (options.preprodOn) {
    await seedNetwork("preprod");
  }

  const core = createCoreApp();
  const app = new Hono().use(requestId()).route("/", core);

  return {
    app,
    shared,
    createNetworkScope,
    serializableTransaction,
    moveTaskJobs,
    deletePersonalWorkspace,
    prepareOrganizationForDeletion,
    prepareTasksForUserDeletion,
    database,
    drop: async () => {
      (globalThis as { coreDatabase?: unknown }).coreDatabase = undefined;
      await Promise.all(
        pools.splice(poolsBefore).map((p) => p.end().catch(() => {})),
      );
      await database.drop();
    },
  };
}

type World = Awaited<ReturnType<typeof buildWorld>>;

async function snapshotPublicTables(shared: World["shared"]) {
  const [jobs, jobInputs, tasks, projects, shares] = await Promise.all([
    shared.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "public"."Job" ORDER BY id`,
    ),
    shared.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "public"."jobInput" ORDER BY "eventId"`,
    ),
    shared.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT id, "workspaceId", "projectId", "archivedAt" FROM "public"."task" ORDER BY id`,
    ),
    shared.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT id, "workspaceId", name FROM "public"."project" ORDER BY id`,
    ),
    shared.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT "jobId", "allowSearchIndexing" FROM "public"."jobShare" ORDER BY "jobId"`,
    ),
  ]);
  return { jobs, jobInputs, tasks, projects, shares };
}

async function snapshotSchemaJobs(shared: World["shared"], schema: string) {
  const [jobs, jobInputs] = await Promise.all([
    shared.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "${schema}"."Job" ORDER BY id`,
    ),
    shared.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "${schema}"."jobInput" ORDER BY "eventId"`,
    ),
  ]);
  return { jobs, jobInputs };
}

function serializeWholeRow(row: Record<string, unknown>): string {
  return JSON.stringify(row, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

/**
 * Asserts every column (including `agentApiBaseUrl`, `createdAt`, `updatedAt`)
 * of every affected and adjacent Job row in PostgreSQL before and after a write.
 */
function expectOnlyJobRowsChanged(
  before: Record<string, unknown>[],
  after: Record<string, unknown>[],
  changesById: Record<string, Record<string, unknown>>,
  label: string,
) {
  expect(after.length, `${label} job row count`).toBe(before.length);
  const expected = before.map((row) => {
    const id = String(row.id);
    const patch = changesById[id];
    return patch ? { ...row, ...patch } : row;
  });
  expect(
    after.map(serializeWholeRow),
    `${label} whole-row Job diff (all columns + timestamps)`,
  ).toEqual(expected.map(serializeWholeRow));
}

function extractTxBoundaries(
  stmts: readonly { text: string; values: unknown[] }[],
) {
  return stmts
    .map((s, index) => ({ index, text: s.text.trim() }))
    .filter((s) =>
      /^(BEGIN|COMMIT|ROLLBACK|SET\s+TRANSACTION)\b/i.test(s.text),
    );
}

async function runCase(
  world: World,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
  network?: string,
  options: { snapshot?: boolean; fakeClock?: boolean; clock?: Date } = {},
) {
  sellerCalls.length = 0;
  publishedInvalidations.length = 0;
  const fakeClock = options.fakeClock ?? true;
  if (fakeClock) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(options.clock ?? WRITE_CLOCK);
  }
  try {
    const { outcome, log } = await observing(async () => {
      const res = await world.app.request(`https://example.com${path}`, {
        method,
        headers: {
          origin: "https://example.com",
          "X-Request-Id": "jw-req-fixed",
          ...headers,
          ...(network ? { "X-Sokosumi-Network": network } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.text() };
    });
    if ("threw" in outcome) throw new Error(JSON.stringify(outcome.threw));
    return {
      status: outcome.status,
      body: outcome.body,
      statements: log.map(({ connection, text, values }) => ({
        connection,
        text,
        values,
      })),
      sellerCalls: [...sellerCalls],
      publishedInvalidations: [...publishedInvalidations],
      ...(options.snapshot !== false && !onSplitLayout
        ? { rows: await snapshotPublicTables(world.shared) }
        : {}),
    };
  } finally {
    if (fakeClock) vi.useRealTimers();
  }
}

async function expectPreprodWriteRefusals(
  world: World,
  headers: Record<string, string>,
  kind: "preprod_off" | "preprod_access_required",
) {
  const writes: [string, string, unknown?][] = [
    [
      "POST",
      `/v1/jobs/${JOB_STANDALONE}/inputs`,
      { eventId: `evt-await-${JOB_STANDALONE}`, inputData: { answer: "no" } },
    ],
    [
      "PUT",
      `/v1/jobs/${JOB_STANDALONE}/workspace`,
      { organizationId: ORG_B_ID },
    ],
    ["POST", `/v1/projects/${PROJ_A1}/jobs`, { jobId: JOB_STANDALONE }],
    ["DELETE", `/v1/projects/${PROJ_A1}/jobs/${JOB_WITH_PROJECT}`],
  ];

  const networkTables = [
    ...Object.values(tableLayout.network),
    ...tableLayout.networkJoinTables,
  ];
  const client = new Client({ connectionString: world.database.url });
  await client.connect();
  try {
    for (const [method, path, body] of writes) {
      const answer = await runCase(
        world,
        method,
        path,
        headers,
        body,
        "preprod",
        {
          snapshot: false,
        },
      );
      expect(answer.status, `${method} ${path}: ${answer.body}`).toBe(403);
      expect(JSON.parse(answer.body), `${method} ${path}`).toMatchObject({
        kind,
      });
      expect(answer.sellerCalls, `${method} ${path}`).toEqual([]);

      await client.query("BEGIN");
      try {
        for (const stmt of answer.statements) {
          if (
            /^\s*(BEGIN|COMMIT|ROLLBACK|SET\s+TRANSACTION)\b/i.test(stmt.text)
          )
            continue;
          await client.query(`EXPLAIN ${stmt.text}`, stmt.values);
        }
        const { rows } = await client.query(
          `SELECT c.relname
           FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
           WHERE l.pid = pg_backend_pid() AND c.relkind IN ('r', 'p', 'f')
             AND c.relname = ANY($1::text[])`,
          [networkTables],
        );
        expect(rows, `${method} ${path}`).toEqual([]);
      } finally {
        await client.query("ROLLBACK");
      }
    }
  } finally {
    await client.end();
  }
}

const MAINNET_PARITY_SEQ: [
  string,
  string,
  string,
  Record<string, string>,
  unknown?,
  number?,
][] = [
  // 1. PATCH /v1/jobs/:id (rename)
  [
    "patch_owner_standalone",
    "PATCH",
    `/v1/jobs/${JOB_STANDALONE}`,
    OWNER_ORG_A,
    { name: "Renamed 1" },
    200,
  ],
  [
    "patch_member_other_owned",
    "PATCH",
    `/v1/jobs/${JOB_STANDALONE}`,
    MEMBER_ORG_A,
    { name: "Nope" },
    403,
  ],
  [
    "patch_missing_job",
    "PATCH",
    "/v1/jobs/jw-missing",
    OWNER_ORG_A,
    { name: "Nope" },
    403,
  ],
  [
    "patch_no_owner_member_seated",
    "PATCH",
    `/v1/jobs/${JOB_NO_OWNER}`,
    MEMBER_ORG_A,
    { name: "NoOwner Renamed" },
    200,
  ],
  [
    "patch_no_owner_unseated_personal_ctx",
    "PATCH",
    `/v1/jobs/${JOB_NO_OWNER}`,
    auth(UNSEATED_ID),
    { name: "Nope" },
    403,
  ],
  [
    "patch_no_owner_outsider",
    "PATCH",
    `/v1/jobs/${JOB_NO_OWNER}`,
    OUTSIDER_HDR,
    { name: "Nope" },
    403,
  ],
  [
    "patch_parked_task",
    "PATCH",
    `/v1/jobs/${JOB_PARKED_TASK}`,
    OWNER_ORG_A,
    { name: "Nope" },
    403,
  ],
  [
    "patch_archived_task",
    "PATCH",
    `/v1/jobs/${JOB_ARCHIVED_TASK}`,
    OWNER_ORG_A,
    { name: "Nope" },
    404,
  ],
  [
    "patch_cw_assigned",
    "PATCH",
    `/v1/jobs/${JOB_PUBLIC_TASK}`,
    CW_ASSIGNED_HDR,
    { name: "CW Renamed" },
    200,
  ],
  [
    "patch_cw_unassigned",
    "PATCH",
    `/v1/jobs/${JOB_PUBLIC_TASK}`,
    CW_OTHER_HDR,
    { name: "Nope" },
    403,
  ],
  [
    "patch_cw_standalone",
    "PATCH",
    `/v1/jobs/${JOB_STANDALONE}`,
    CW_ASSIGNED_HDR,
    { name: "Nope" },
    403,
  ],
  [
    "patch_cw_nocap",
    "PATCH",
    `/v1/jobs/${JOB_PUBLIC_TASK}`,
    CW_NOCAP_HDR,
    { name: "Nope" },
    403,
  ],
  [
    "patch_cw_bare",
    "PATCH",
    `/v1/jobs/${JOB_PUBLIC_TASK}`,
    CW_BARE_HDR,
    { name: "Nope" },
    403,
  ],
  [
    "patch_bot_assigned",
    "PATCH",
    `/v1/jobs/${JOB_BOT_TASK}`,
    BOT_HDR,
    { name: "Bot Renamed" },
    200,
  ],
  [
    "patch_bot_other_ws",
    "PATCH",
    `/v1/jobs/${JOB_STANDALONE}`,
    BOT_HDR,
    { name: "Nope" },
    404,
  ],

  // 2. POST /v1/jobs/:id/inputs
  [
    "input_owner_ok",
    "POST",
    `/v1/jobs/${JOB_STANDALONE}/inputs`,
    OWNER_ORG_A,
    { eventId: `evt-await-${JOB_STANDALONE}`, inputData: { answer: "42" } },
    201,
  ],
  [
    "input_already_provided",
    "POST",
    `/v1/jobs/${JOB_STANDALONE}/inputs`,
    OWNER_ORG_A,
    { eventId: "evt-answered", inputData: { answer: "42" } },
    409,
  ],
  [
    "input_no_schema",
    "POST",
    `/v1/jobs/${JOB_STANDALONE}/inputs`,
    OWNER_ORG_A,
    { eventId: "evt-noschema", inputData: { answer: "42" } },
    422,
  ],
  [
    "input_empty_data",
    "POST",
    `/v1/jobs/${JOB_STANDALONE}/inputs`,
    OWNER_ORG_A,
    { eventId: `evt-await-${JOB_STANDALONE}`, inputData: {} },
    400,
  ],
  [
    "input_event_not_found",
    "POST",
    `/v1/jobs/${JOB_STANDALONE}/inputs`,
    OWNER_ORG_A,
    { eventId: "evt-missing", inputData: { answer: "42" } },
    404,
  ],
  [
    "input_no_owner_member_ok",
    "POST",
    `/v1/jobs/${JOB_NO_OWNER}/inputs`,
    MEMBER_ORG_A,
    { eventId: `evt-await-${JOB_NO_OWNER}`, inputData: { answer: "yes" } },
    201,
  ],
  [
    "input_no_owner_unseated_403",
    "POST",
    `/v1/jobs/${JOB_NO_OWNER}/inputs`,
    auth(UNSEATED_ID),
    { eventId: `evt-await-${JOB_NO_OWNER}`, inputData: { answer: "yes" } },
    403,
  ],
  [
    "input_parked_task_403",
    "POST",
    `/v1/jobs/${JOB_PARKED_TASK}/inputs`,
    OWNER_ORG_A,
    { eventId: `evt-await-${JOB_PARKED_TASK}`, inputData: { answer: "yes" } },
    403,
  ],
  [
    "input_archived_task_404",
    "POST",
    `/v1/jobs/${JOB_ARCHIVED_TASK}/inputs`,
    OWNER_ORG_A,
    { eventId: `evt-await-${JOB_ARCHIVED_TASK}`, inputData: { answer: "yes" } },
    404,
  ],
  [
    "input_cw_assigned_ok",
    "POST",
    `/v1/jobs/${JOB_PUBLIC_TASK}/inputs`,
    CW_ASSIGNED_HDR,
    { eventId: `evt-await-${JOB_PUBLIC_TASK}`, inputData: { answer: "cw" } },
    201,
  ],
  [
    "input_cw_other_403",
    "POST",
    `/v1/jobs/${JOB_PUBLIC_TASK}/inputs`,
    CW_OTHER_HDR,
    { eventId: `evt-await-${JOB_PUBLIC_TASK}`, inputData: { answer: "cw" } },
    403,
  ],
  [
    "input_bot_ok",
    "POST",
    `/v1/jobs/${JOB_BOT_TASK}/inputs`,
    BOT_HDR,
    { eventId: `evt-await-${JOB_BOT_TASK}`, inputData: { answer: "bot" } },
    201,
  ],

  // 3. POST /v1/projects/:id/jobs & DELETE /v1/projects/:id/jobs/:jobId
  [
    "link_standalone_ok",
    "POST",
    `/v1/projects/${PROJ_A1}/jobs`,
    OWNER_ORG_A,
    { jobId: JOB_STANDALONE },
    200,
  ],
  [
    "link_standalone_idempotent",
    "POST",
    `/v1/projects/${PROJ_A1}/jobs`,
    OWNER_ORG_A,
    { jobId: JOB_STANDALONE },
    200,
  ],
  [
    "link_conflict_other_proj",
    "POST",
    `/v1/projects/${PROJ_A2}/jobs`,
    OWNER_ORG_A,
    { jobId: JOB_STANDALONE },
    409,
  ],
  [
    "link_private_task_other_member_404",
    "POST",
    `/v1/projects/${PROJ_A1}/jobs`,
    MEMBER_ORG_A,
    { jobId: JOB_PRIVATE_TASK },
    404,
  ],
  [
    "link_private_task_owner_ok",
    "POST",
    `/v1/projects/${PROJ_A1}/jobs`,
    OWNER_ORG_A,
    { jobId: JOB_PRIVATE_TASK },
    200,
  ],
  [
    "link_public_task_member_ok",
    "POST",
    `/v1/projects/${PROJ_A1}/jobs`,
    MEMBER_ORG_A,
    { jobId: JOB_PUBLIC_TASK },
    200,
  ],
  [
    "link_missing_project_404",
    "POST",
    "/v1/projects/25300000-0000-4000-8000-000000000099/jobs",
    OWNER_ORG_A,
    { jobId: JOB_STANDALONE },
    404,
  ],
  [
    "link_missing_job_404",
    "POST",
    `/v1/projects/${PROJ_A1}/jobs`,
    OWNER_ORG_A,
    { jobId: "jw-missing" },
    404,
  ],
  [
    "unlink_private_task_other_member_404",
    "DELETE",
    `/v1/projects/${PROJ_A1}/jobs/${JOB_PRIVATE_TASK}`,
    MEMBER_ORG_A,
    undefined,
    404,
  ],
  [
    "unlink_private_task_owner_ok",
    "DELETE",
    `/v1/projects/${PROJ_A1}/jobs/${JOB_PRIVATE_TASK}`,
    OWNER_ORG_A,
    undefined,
    200,
  ],
  [
    "unlink_standalone_ok",
    "DELETE",
    `/v1/projects/${PROJ_A1}/jobs/${JOB_STANDALONE}`,
    OWNER_ORG_A,
    undefined,
    200,
  ],
  [
    "unlink_already_unlinked_404",
    "DELETE",
    `/v1/projects/${PROJ_A1}/jobs/${JOB_STANDALONE}`,
    OWNER_ORG_A,
    undefined,
    404,
  ],
  [
    "unlink_missing_project_404",
    "DELETE",
    `/v1/projects/25300000-0000-4000-8000-000000000099/jobs/${JOB_STANDALONE}`,
    OWNER_ORG_A,
    undefined,
    404,
  ],

  // 4. PUT /v1/jobs/:id/workspace (including condition (i): org A admin -> org B plain member)
  [
    "move_job_noop",
    "PUT",
    `/v1/jobs/${JOB_STANDALONE}/workspace`,
    OWNER_ORG_A,
    { organizationId: ORG_A_ID },
    200,
  ],
  [
    "move_job_task_attached_409",
    "PUT",
    `/v1/jobs/${JOB_PUBLIC_TASK}/workspace`,
    OWNER_ORG_A,
    { organizationId: ORG_B_ID },
    409,
  ],
  [
    "move_job_cmo_project_409",
    "PUT",
    `/v1/jobs/${JOB_CMO_PROJECT}/workspace`,
    OWNER_ORG_A,
    { organizationId: ORG_B_ID },
    409,
  ],
  [
    "move_job_no_owner_member_403",
    "PUT",
    `/v1/jobs/${JOB_NO_OWNER_MOVE}/workspace`,
    MEMBER_ORG_A,
    { organizationId: ORG_B_ID },
    403,
  ],
  [
    "move_job_no_owner_to_personal_400",
    "PUT",
    `/v1/jobs/${JOB_NO_OWNER_MOVE}/workspace`,
    ADMIN_ORG_A,
    { organizationId: null },
    400,
  ],
  [
    "move_job_no_owner_admin_to_org_b",
    "PUT",
    `/v1/jobs/${JOB_NO_OWNER_MOVE}/workspace`,
    ADMIN_ORG_A,
    { organizationId: ORG_B_ID },
    200,
  ],
  [
    "move_job_with_project_to_org_b",
    "PUT",
    `/v1/jobs/${JOB_WITH_PROJECT}/workspace`,
    OWNER_ORG_A,
    { organizationId: ORG_B_ID },
    200,
  ],
  [
    "move_job_personal_to_org_b",
    "PUT",
    `/v1/jobs/${JOB_MOVE_PERSONAL}/workspace`,
    auth(OWNER_ID),
    { organizationId: ORG_B_ID },
    200,
  ],

  // 5. PUT /v1/tasks/:id/workspace
  [
    "move_task_noop",
    "PUT",
    `/v1/tasks/${TASK_MOVABLE}/workspace`,
    OWNER_ORG_A,
    { organizationId: ORG_A_ID },
    200,
  ],
  [
    "move_task_parked_403",
    "PUT",
    `/v1/tasks/${TASK_PARKED}/workspace`,
    OWNER_ORG_A,
    { organizationId: ORG_B_ID },
    403,
  ],
  [
    "move_task_private_to_personal_400",
    "PUT",
    `/v1/tasks/${TASK_PRIVATE_MOVABLE}/workspace`,
    OWNER_ORG_A,
    { organizationId: null },
    400,
  ],
  [
    "move_task_linked_409",
    "PUT",
    `/v1/tasks/${TASK_LINKED_A}/workspace`,
    OWNER_ORG_A,
    { organizationId: ORG_B_ID },
    409,
  ],
  [
    "move_task_with_job_to_org_b",
    "PUT",
    `/v1/tasks/${TASK_MOVABLE}/workspace`,
    OWNER_ORG_A,
    { organizationId: ORG_B_ID },
    200,
  ],

  // 6. PUT / DELETE /v1/jobs/:id/share & Jobs router non-preprod checks
  [
    "share_put_owner_ok",
    "PUT",
    `/v1/jobs/${JOB_SHARE_TARGET}/share`,
    OWNER_ORG_A,
    { allowSearchIndexing: true },
    200,
  ],
  [
    "share_put_private_task_400",
    "PUT",
    `/v1/jobs/${JOB_PRIVATE_TASK}/share`,
    OWNER_ORG_A,
    { allowSearchIndexing: false },
    400,
  ],
  [
    "share_delete_owner_ok",
    "DELETE",
    `/v1/jobs/${JOB_SHARE_TARGET}/share`,
    OWNER_ORG_A,
    undefined,
    200,
  ],
  [
    "jobs_options_share",
    "OPTIONS",
    `/v1/jobs/${JOB_SHARE_TARGET}/share`,
    OWNER_ORG_A,
    undefined,
    204,
  ],
  [
    "jobs_wrong_method_share",
    "GET",
    `/v1/jobs/${JOB_SHARE_TARGET}/share`,
    OWNER_ORG_A,
    undefined,
    404,
  ],
  [
    "jobs_unserved_path",
    "GET",
    "/v1/jobs/__nonexistent_25_3/extra",
    OWNER_ORG_A,
    undefined,
    404,
  ],
];

const EXPECTED_MAINNET_JOB_CHANGES: Record<
  string,
  Record<string, Record<string, unknown>>
> = {
  patch_owner_standalone: {
    [JOB_STANDALONE]: { name: "Renamed 1", updatedAt: WRITE_CLOCK },
  },
  patch_no_owner_member_seated: {
    [JOB_NO_OWNER]: { name: "NoOwner Renamed", updatedAt: WRITE_CLOCK },
  },
  patch_cw_assigned: {
    [JOB_PUBLIC_TASK]: { name: "CW Renamed", updatedAt: WRITE_CLOCK },
  },
  patch_bot_assigned: {
    [JOB_BOT_TASK]: { name: "Bot Renamed", updatedAt: WRITE_CLOCK },
  },
  link_standalone_ok: {
    [JOB_STANDALONE]: { projectId: PROJ_A1, updatedAt: WRITE_CLOCK },
  },
  link_private_task_owner_ok: {
    [JOB_PRIVATE_TASK]: { projectId: PROJ_A1, updatedAt: WRITE_CLOCK },
  },
  link_public_task_member_ok: {
    [JOB_PUBLIC_TASK]: { projectId: PROJ_A1, updatedAt: WRITE_CLOCK },
  },
  unlink_private_task_owner_ok: {
    [JOB_PRIVATE_TASK]: { projectId: null, updatedAt: WRITE_CLOCK },
  },
  unlink_standalone_ok: {
    [JOB_STANDALONE]: { projectId: null, updatedAt: WRITE_CLOCK },
  },
  move_job_no_owner_admin_to_org_b: {
    [JOB_NO_OWNER_MOVE]: {
      workspaceId: WS_ORG_B,
      projectId: null,
      updatedAt: WRITE_CLOCK,
    },
  },
  move_job_with_project_to_org_b: {
    [JOB_WITH_PROJECT]: {
      workspaceId: WS_ORG_B,
      projectId: null,
      updatedAt: WRITE_CLOCK,
    },
  },
  move_job_personal_to_org_b: {
    [JOB_MOVE_PERSONAL]: {
      workspaceId: WS_ORG_B,
      projectId: null,
      updatedAt: WRITE_CLOCK,
    },
  },
  move_task_with_job_to_org_b: {
    [JOB_MOVABLE_TASK]: {
      workspaceId: WS_ORG_B,
      projectId: null,
      updatedAt: WRITE_CLOCK,
    },
  },
};

describe.runIf(enabled && !onSplitLayout)(
  "Job writes over PostgreSQL — today's layout (Mainnet parity & Preprod off)",
  () => {
    it("matches origin/main across all 122 Mainnet cases (no header and mainnet header) with zero Mainnet changes", {
      timeout: 120_000,
    }, async () => {
      type BaselineEntry = {
        status: number;
        body: string;
        jobRowsExact: string;
        jobInputRowsExact: string;
        rows: string;
        sellerCalls: unknown[];
        publishedInvalidations: string[];
        statementCount: number;
        statementsOrdered: string;
        txBoundaries: { index: number; text: string }[];
      };
      const baseline = recording
        ? null
        : (JSON.parse(readFileSync(basePath, "utf8")) as Record<
            string,
            BaselineEntry
          >);
      const recorded: Record<string, unknown> = {};
      const nextBaseline: Record<string, BaselineEntry> = {};

      for (const network of [undefined, "mainnet"] as const) {
        const suffix = network ?? "implicit";
        const world = await buildWorld({ preprodOn: false });
        const generatedIdentities = new Map<string, string>();
        try {
          let previousJobs = (await snapshotPublicTables(world.shared)).jobs;
          const runAndVerify = async (
            name: string,
            method: string,
            path: string,
            hdrs: Record<string, string>,
            body?: unknown,
            expectedStatus?: number,
          ) => {
            const key = `${name}:${suffix}`;
            const res = await runCase(world, method, path, hdrs, body, network);
            if (expectedStatus !== undefined) {
              expect(res.status, `${key}: ${res.body}`).toBe(expectedStatus);
            }
            const afterJobs = res.rows?.jobs ?? [];
            const afterJobInputs = res.rows?.jobInputs ?? [];
            expectOnlyJobRowsChanged(
              previousJobs,
              afterJobs,
              EXPECTED_MAINNET_JOB_CHANGES[name] ?? {},
              key,
            );
            previousJobs = afterJobs;

            if (
              method === "POST" &&
              path.endsWith("/inputs") &&
              res.status === 201
            ) {
              const reqBody = body as {
                eventId: string;
                inputData: Record<string, unknown>;
              };
              const createdInputId = assertJobInputWrite({
                label: key,
                schema: "public",
                res,
                expectedEventId: reqBody.eventId,
                expectedInputData: reqBody.inputData,
                expectedClock: WRITE_CLOCK,
                storedRows: afterJobInputs,
              });
              expect(
                generatedIdentities.has(createdInputId),
                `${key} unique input id`,
              ).toBe(false);
              generatedIdentities.set(createdInputId, `<INPUT_ID:${name}>`);
            }

            if (
              method === "PUT" &&
              path.endsWith("/share") &&
              res.status === 200
            ) {
              const share = (
                JSON.parse(res.body) as {
                  data: { id: string; token: string };
                }
              ).data;
              expect(share.id, `${key} generated share id`).toMatch(UUID_RE);
              expect(share.token, `${key} generated share token`).toMatch(
                UUID_RE,
              );
              const expectedPgTs = formatPgTimestampUtc(WRITE_CLOCK);
              const insertShare = res.statements.filter((stmt) =>
                stmt.text.includes('INSERT INTO "public"."jobShare"'),
              );
              expect(insertShare, `${key} INSERT jobShare count`).toHaveLength(
                1,
              );
              expect(
                insertShare[0]?.values,
                `${key} literal INSERT jobShare binds`,
              ).toEqual([
                share.id,
                expectedPgTs,
                expectedPgTs,
                JOB_SHARE_TARGET,
                share.token,
                true,
              ]);
              const selectShare = res.statements.filter(
                (stmt) =>
                  stmt.text.includes('FROM "public"."jobShare"') &&
                  stmt.text.includes('"public"."jobShare"."id" = $1'),
              );
              expect(selectShare, `${key} SELECT jobShare count`).toHaveLength(
                1,
              );
              expect(selectShare[0]?.values[0]).toBe(share.id);
              generatedIdentities.set(share.id, `<SHARE_ID:${name}>`);
              generatedIdentities.set(share.token, `<SHARE_TOKEN:${name}>`);
            }

            const stmts = res.statements.map(({ text, values }) => ({
              text,
              values,
            }));
            const entry: BaselineEntry = {
              status: res.status,
              body: sha256(
                mapGeneratedIdentities(res.body, generatedIdentities),
              ),
              jobRowsExact: sha256(
                JSON.stringify(afterJobs.map(serializeWholeRow)),
              ),
              jobInputRowsExact: sha256(
                mapGeneratedIdentities(
                  afterJobInputs.map(serializeWholeRow),
                  generatedIdentities,
                ),
              ),
              rows: sha256(
                mapGeneratedIdentities(res.rows, generatedIdentities),
              ),
              sellerCalls: res.sellerCalls,
              publishedInvalidations: res.publishedInvalidations,
              statementCount: stmts.length,
              statementsOrdered: sha256(
                mapGeneratedIdentities(stmts, generatedIdentities),
              ),
              txBoundaries: extractTxBoundaries(stmts),
            };
            recorded[key] = res;
            nextBaseline[key] = entry;
            if (!baseline) return;

            const expected = baseline[key];
            expect(expected, `missing baseline ${key}`).toBeDefined();
            expect(entry.status, key).toBe(expected.status);
            expect(entry.body, `${key} body`).toBe(expected.body);
            expect(
              entry.jobRowsExact,
              `${key} all-column Job rows + exact timestamps`,
            ).toBe(expected.jobRowsExact);
            expect(
              entry.jobInputRowsExact,
              `${key} all-column jobInput rows + exact timestamps`,
            ).toBe(expected.jobInputRowsExact);
            expect(entry.rows, `${key} rows`).toBe(expected.rows);
            expect(entry.sellerCalls, `${key} sellerCalls`).toEqual(
              expected.sellerCalls,
            );
            expect(
              entry.publishedInvalidations,
              `${key} invalidations`,
            ).toEqual(expected.publishedInvalidations);
            expect(entry.statementCount, `${key} stmt count`).toBe(
              expected.statementCount,
            );
            expect(entry.txBoundaries, `${key} transaction boundaries`).toEqual(
              expected.txBoundaries,
            );
            expect(
              entry.statementsOrdered,
              `${key} exact SQL + literal bound values + order`,
            ).toBe(expected.statementsOrdered);
          };

          for (const [
            name,
            method,
            path,
            hdrs,
            body,
            status,
          ] of MAINNET_PARITY_SEQ) {
            await runAndVerify(name, method, path, hdrs, body, status);
          }
          const invalidHdr = await runCase(
            world,
            "PUT",
            `/v1/jobs/${JOB_SHARE_TARGET}/share`,
            OWNER_ORG_A,
            { allowSearchIndexing: true },
            "testnet",
          );
          expect(invalidHdr.status).toBe(400);
          const invalidStmts = invalidHdr.statements.map(
            ({ text, values }) => ({ text, values }),
          );
          const invalidEntry: BaselineEntry = {
            status: invalidHdr.status,
            body: sha256(
              mapGeneratedIdentities(invalidHdr.body, generatedIdentities),
            ),
            jobRowsExact: sha256(
              JSON.stringify(
                (invalidHdr.rows?.jobs ?? []).map(serializeWholeRow),
              ),
            ),
            jobInputRowsExact: sha256(
              mapGeneratedIdentities(
                (invalidHdr.rows?.jobInputs ?? []).map(serializeWholeRow),
                generatedIdentities,
              ),
            ),
            rows: sha256(
              mapGeneratedIdentities(invalidHdr.rows, generatedIdentities),
            ),
            sellerCalls: invalidHdr.sellerCalls,
            publishedInvalidations: invalidHdr.publishedInvalidations,
            statementCount: invalidStmts.length,
            statementsOrdered: sha256(
              mapGeneratedIdentities(invalidStmts, generatedIdentities),
            ),
            txBoundaries: extractTxBoundaries(invalidStmts),
          };
          nextBaseline[`share_put_invalid_header:${suffix}`] = invalidEntry;
          if (baseline) {
            const exp = baseline[`share_put_invalid_header:${suffix}`];
            expect(invalidEntry).toEqual(exp);
          }
          recorded[`share_put_invalid_header:${suffix}`] = invalidHdr;

          sellerOutcome.next = { err: "Seller rejected input" };
          await runAndVerify(
            "input_seller_fail_422",
            "POST",
            `/v1/jobs/${JOB_STANDALONE}/inputs`,
            OWNER_ORG_A,
            { eventId: "evt-seller-fail", inputData: { answer: "x" } },
            422,
          );
        } finally {
          await world.drop();
        }
      }

      if (recording) {
        writeFileSync(basePath, `${JSON.stringify(nextBaseline, null, 2)}\n`);
      }
      if (rawTracePath) {
        writeFileSync(rawTracePath, `${JSON.stringify(recorded, null, 2)}\n`);
      }
    });

    it("times out POST /v1/jobs/:id/inputs with 500, 0 seller calls, and 0 inputs when jobEvent is held for 6.3s", {
      timeout: 30_000,
    }, async () => {
      expectCoreLog(
        "warn",
        "Kept a transient external failure out of Sentry",
        1,
      );
      const world = await buildWorld({ preprodOn: false });
      const locker = new Client({ connectionString: world.database.url });
      await locker.connect();
      try {
        await locker.query("BEGIN");
        await locker.query(
          'LOCK TABLE "public"."jobEvent" IN ACCESS EXCLUSIVE MODE',
        );

        sellerCalls.length = 0;
        const started = Date.now();
        const reqPromise = world.app.request(
          `https://example.com/v1/jobs/${JOB_STANDALONE}/inputs`,
          {
            method: "POST",
            headers: {
              origin: "https://example.com",
              "content-type": "application/json",
              ...OWNER_ORG_A,
            },
            body: JSON.stringify({
              eventId: `evt-await-${JOB_STANDALONE}`,
              inputData: { answer: "delayed" },
            }),
          },
        );

        let observedWaiting = false;
        const observer = new Client({ connectionString: world.database.url });
        await observer.connect();
        try {
          for (let i = 0; i < 60; i++) {
            const { rowCount } = await observer.query(
              `SELECT pid FROM pg_stat_activity
               WHERE datname = current_database()
                 AND cardinality(pg_blocking_pids(pid)) > 0`,
            );
            if (rowCount && rowCount > 0) {
              observedWaiting = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 25));
          }
        } finally {
          await observer.end();
        }
        expect(observedWaiting).toBe(true);

        const remaining = 6_300 - (Date.now() - started);
        if (remaining > 0) {
          await new Promise((r) => setTimeout(r, remaining));
        }
        await locker.query("ROLLBACK");

        const res = await reqPromise;
        expect(res.status).toBe(500);
        expect(sellerCalls).toHaveLength(0);
        const inserted = await world.shared.jobInput.findUnique({
          where: { eventId: `evt-await-${JOB_STANDALONE}` },
        });
        expect(inserted).toBeNull();
      } finally {
        await locker.query("ROLLBACK").catch(() => {});
        await locker.end();
        await world.drop();
      }
    });

    it("refuses Preprod on all 4 moved Job writes with zero Network table locks and refuses Preprod Job shares with 422", {
      timeout: 60_000,
    }, async () => {
      const world = await buildWorld({ preprodOn: false });
      try {
        const before = await snapshotPublicTables(world.shared);
        await expectPreprodWriteRefusals(world, OWNER_ORG_A, "preprod_off");

        for (const [method, body] of [
          ["PUT", { allowSearchIndexing: true }],
          ["DELETE", undefined],
        ] as const) {
          const res = await runCase(
            world,
            method,
            `/v1/jobs/${JOB_SHARE_TARGET}/share`,
            OWNER_ORG_A,
            body,
            "preprod",
            { snapshot: false },
          );
          expect(res.status, `${method} share preprod`).toBe(422);
          expect(JSON.parse(res.body)).toMatchObject({
            kind: "mainnet_only_feature",
          });
        }

        const after = await snapshotPublicTables(world.shared);
        expect(after).toEqual(before);
      } finally {
        await world.drop();
      }
    });

    it("pins raw SQL updatedAt to UTC matching Prisma @updatedAt under frozen and real clocks", {
      timeout: 60_000,
    }, async () => {
      const world = await buildWorld({ preprodOn: false });
      try {
        // Frozen clock pin
        const frozen = new Date("2026-11-28T12:34:56.789Z");
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(frozen);
        try {
          const patchRes = await world.app.request(
            `https://example.com/v1/jobs/${JOB_STANDALONE}`,
            {
              method: "PATCH",
              headers: {
                origin: "https://example.com",
                "content-type": "application/json",
                ...OWNER_ORG_A,
              },
              body: JSON.stringify({ name: "Clock Prisma" }),
            },
          );
          expect(patchRes.status).toBe(200);
          const moveRes = await world.app.request(
            `https://example.com/v1/jobs/${JOB_WITH_PROJECT}/workspace`,
            {
              method: "PUT",
              headers: {
                origin: "https://example.com",
                "content-type": "application/json",
                ...OWNER_ORG_A,
              },
              body: JSON.stringify({ organizationId: ORG_B_ID }),
            },
          );
          expect(moveRes.status).toBe(200);
          const taskMoveRes = await world.app.request(
            `https://example.com/v1/tasks/${TASK_MOVABLE}/workspace`,
            {
              method: "PUT",
              headers: {
                origin: "https://example.com",
                "content-type": "application/json",
                ...OWNER_ORG_A,
              },
              body: JSON.stringify({ organizationId: ORG_B_ID }),
            },
          );
          expect(taskMoveRes.status).toBe(200);
        } finally {
          vi.useRealTimers();
        }

        const [jPrisma, jRawMove, jRawTask] = await Promise.all([
          world.shared.job.findUniqueOrThrow({ where: { id: JOB_STANDALONE } }),
          world.shared.job.findUniqueOrThrow({
            where: { id: JOB_WITH_PROJECT },
          }),
          world.shared.job.findUniqueOrThrow({
            where: { id: JOB_MOVABLE_TASK },
          }),
        ]);
        expect(jRawMove.updatedAt.toISOString()).toBe(frozen.toISOString());
        expect(jRawTask.updatedAt.toISOString()).toBe(frozen.toISOString());
        expect(jRawMove.updatedAt.toISOString()).toBe(
          jPrisma.updatedAt.toISOString(),
        );

        // Real clock pin
        const startMs = await nextMillisecond();
        const realMove = await world.app.request(
          `https://example.com/v1/jobs/${JOB_MOVE_PERSONAL}/workspace`,
          {
            method: "PUT",
            headers: {
              origin: "https://example.com",
              "content-type": "application/json",
              ...auth(OWNER_ID),
            },
            body: JSON.stringify({ organizationId: ORG_B_ID }),
          },
        );
        expect(realMove.status).toBe(200);
        const endMs = Date.now();
        const jReal = await world.shared.job.findUniqueOrThrow({
          where: { id: JOB_MOVE_PERSONAL },
        });
        expect(jReal.updatedAt.getTime()).toBeGreaterThanOrEqual(startMs);
        expect(jReal.updatedAt.getTime()).toBeLessThanOrEqual(endMs);
      } finally {
        await world.drop();
      }
    });

    it("proves two-movers race, in-transaction readback snapshot races (creator delete, rename, second move, delete), and ticket 26 deletion interleavings", {
      timeout: 120_000,
    }, async () => {
      const raceReport: Record<string, unknown> = {};

      // 1. Two-movers race on PUT /v1/jobs/:id/workspace
      {
        const world = await buildWorld({ preprodOn: false });
        try {
          const gate = holdCommit("moverA", 1);
          let gateReached = false;
          const { outcome, log } = await observing(async () => {
            const pA = inFlow(
              "moverA",
              async () =>
                await world.app.request(
                  `https://example.com/v1/jobs/${JOB_STANDALONE}/workspace`,
                  {
                    method: "PUT",
                    headers: {
                      origin: "https://example.com",
                      "content-type": "application/json",
                      ...OWNER_ORG_A,
                    },
                    body: JSON.stringify({ organizationId: ORG_B_ID }),
                  },
                ),
            );
            await gate.reached;
            gateReached = true;
            const pB = inFlow(
              "moverB",
              async () =>
                await world.app.request(
                  `https://example.com/v1/jobs/${JOB_STANDALONE}/workspace`,
                  {
                    method: "PUT",
                    headers: {
                      origin: "https://example.com",
                      "content-type": "application/json",
                      ...OWNER_ORG_A,
                    },
                    body: JSON.stringify({ organizationId: null }),
                  },
                ),
            );
            await new Promise((r) => setTimeout(r, 80));
            gate.release();
            const [resA, resB] = await Promise.all([pA, pB]);
            return { statusA: resA.status, statusB: resB.status };
          });
          expect(gateReached).toBe(true);
          if ("threw" in outcome)
            throw new Error(JSON.stringify(outcome.threw));
          expect([200, 409]).toContain(outcome.statusA);
          expect([200, 409]).toContain(outcome.statusB);
          const finalJob = await world.shared.job.findUniqueOrThrow({
            where: { id: JOB_STANDALONE },
            select: { workspaceId: true, projectId: true },
          });
          expect([WS_ORG_B, WS_PERSONAL]).toContain(finalJob.workspaceId);
          expect(finalJob.projectId).toBeNull();
          raceReport.twoMovers = {
            ...outcome,
            beginsA: log.filter(
              (s) => s.flow === "moverA" && s.text === "BEGIN",
            ).length,
            beginsB: log.filter(
              (s) => s.flow === "moverB" && s.text === "BEGIN",
            ).length,
            finalJob,
          };
        } finally {
          await world.drop();
        }
      }

      // 2. In-transaction readback races: pin origin/main's snapshot answers
      //    (creator deleted between Job read and relation load, concurrent
      //    rename on update & no-op move, concurrent second move, concurrent Job delete)
      {
        const world = await buildWorld({ preprodOn: false });
        const sideDb = new Client({ connectionString: world.database.url });
        await sideDb.connect();
        try {
          // 2a. Creator deleted between the Job read and its user-relation load on a no-op move -> 200 with original snapshot
          let creatorNoopGateHit = false;
          queryGate.active = {
            when: "before",
            match: (text, values) =>
              text.includes('FROM "public"."user"') &&
              values.includes(MEMBER_ID),
            run: async () => {
              creatorNoopGateHit = true;
              // On a no-op move, Job is not row-locked, so deleting the creator
              // commits BEFORE the transaction reads the creator relation; the
              // Serializable snapshot must still return 200 with the creator.
              await sideDb.query('DELETE FROM "public"."user" WHERE id = $1', [
                MEMBER_ID,
              ]);
            },
          };
          const noopCreatorDel = await world.app.request(
            `https://example.com/v1/jobs/${JOB_SHARE_TARGET}/workspace`,
            {
              method: "PUT",
              headers: {
                origin: "https://example.com",
                "content-type": "application/json",
                ...OWNER_ORG_A,
              },
              body: JSON.stringify({ organizationId: ORG_A_ID }),
            },
          );
          expect(creatorNoopGateHit).toBe(true);
          expect(noopCreatorDel.status).toBe(200);
          const noopCreatorBody = (await noopCreatorDel.json()) as {
            data: {
              creator: { type: string; id: string } | null;
              workspace: { id: string };
            };
          };
          expect(noopCreatorBody.data.workspace.id).toBe(WS_ORG_A);
          expect(noopCreatorBody.data.creator).toMatchObject({
            type: "user",
            id: MEMBER_ID,
          });
          const afterCreatorNoop = await world.shared.job.findUniqueOrThrow({
            where: { id: JOB_SHARE_TARGET },
          });
          expect(afterCreatorNoop.creatorUserId).toBeNull();
          raceReport.inTxCreatorDeleteNoop = {
            status: noopCreatorDel.status,
            creatorId: noopCreatorBody.data.creator?.id ?? null,
            storedCreatorUserId: afterCreatorNoop.creatorUserId,
          };

          // Re-seed a fresh creator user for the update-move creator deletion case
          const tempCreator = "jw-temp-creator";
          await world.shared.user.create({
            data: {
              id: tempCreator,
              name: tempCreator,
              email: `${tempCreator}@example.test`,
              emailVerified: true,
              termsAccepted: true,
              createdAt: CLOCK,
              updatedAt: CLOCK,
            },
          });
          await world.shared.job.update({
            where: { id: JOB_STANDALONE },
            data: { creatorUserId: tempCreator },
          });

          // 2b. Creator deleted concurrently right after COMMIT (or after Job read) on update move -> 200 with original snapshot
          let creatorUpdateGateHit = false;
          queryGate.active = {
            when: "after",
            match: (text) => /^\s*COMMIT\b/i.test(text),
            run: async () => {
              creatorUpdateGateHit = true;
              await sideDb.query('DELETE FROM "public"."user" WHERE id = $1', [
                tempCreator,
              ]);
            },
          };
          const moveCreatorDel = await world.app.request(
            `https://example.com/v1/jobs/${JOB_STANDALONE}/workspace`,
            {
              method: "PUT",
              headers: {
                origin: "https://example.com",
                "content-type": "application/json",
                ...OWNER_ORG_A,
              },
              body: JSON.stringify({ organizationId: ORG_B_ID }),
            },
          );
          expect(creatorUpdateGateHit).toBe(true);
          expect(moveCreatorDel.status).toBe(200);
          const moveCreatorBody = (await moveCreatorDel.json()) as {
            data: {
              creator: { type: string; id: string } | null;
              workspace: { id: string };
            };
          };
          expect(moveCreatorBody.data.workspace.id).toBe(WS_ORG_B);
          expect(moveCreatorBody.data.creator).toMatchObject({
            type: "user",
            id: tempCreator,
          });
          const afterCreatorMove = await world.shared.job.findUniqueOrThrow({
            where: { id: JOB_STANDALONE },
          });
          expect(afterCreatorMove.creatorUserId).toBeNull();
          expect(afterCreatorMove.workspaceId).toBe(WS_ORG_B);
          raceReport.inTxCreatorDeleteUpdate = {
            status: moveCreatorDel.status,
            creatorId: moveCreatorBody.data.creator?.id ?? null,
            storedCreatorUserId: afterCreatorMove.creatorUserId,
          };

          // 2c. Concurrent rename after COMMIT -> 200 with original pre-rename name (matches origin/main)
          let renameGateHit = false;
          queryGate.active = {
            when: "after",
            match: (text) => /^\s*COMMIT\b/i.test(text),
            run: async () => {
              renameGateHit = true;
              await sideDb.query(
                'UPDATE "public"."Job" SET name = $1 WHERE id = $2',
                ["Renamed After Commit", JOB_STANDALONE],
              );
            },
          };
          const moveWithRename = await world.app.request(
            `https://example.com/v1/jobs/${JOB_STANDALONE}/workspace`,
            {
              method: "PUT",
              headers: {
                origin: "https://example.com",
                "content-type": "application/json",
                ...OWNER_ORG_A,
              },
              body: JSON.stringify({ organizationId: ORG_A_ID }),
            },
          );
          expect(renameGateHit).toBe(true);
          expect(moveWithRename.status).toBe(200);
          const renameBody = (await moveWithRename.json()) as {
            data: { name: string; workspace: { id: string } };
          };
          expect(renameBody.data.workspace.id).toBe(WS_ORG_A);
          expect(renameBody.data.name).toBe(`mainnet:${JOB_STANDALONE}`);
          const storedRename = await world.shared.job.findUniqueOrThrow({
            where: { id: JOB_STANDALONE },
          });
          expect(storedRename.workspaceId).toBe(WS_ORG_A);
          expect(storedRename.name).toBe("Renamed After Commit");
          raceReport.inTxConcurrentRename = {
            status: moveWithRename.status,
            returnedWorkspaceId: renameBody.data.workspace.id,
            returnedName: renameBody.data.name,
          };

          // 2d. Concurrent rename during a no-op move -> 200 with original pre-rename name (matches origin/main)
          let noopRenameGateHit = false;
          queryGate.active = {
            when: "before",
            match: (text, values) =>
              text.includes('FROM "public"."jobEvent"') &&
              values.includes(JOB_SHARE_TARGET),
            run: async () => {
              noopRenameGateHit = true;
              await sideDb.query(
                'UPDATE "public"."Job" SET name = $1 WHERE id = $2',
                ["Renamed During Noop", JOB_SHARE_TARGET],
              );
            },
          };
          const noopWithRename = await world.app.request(
            `https://example.com/v1/jobs/${JOB_SHARE_TARGET}/workspace`,
            {
              method: "PUT",
              headers: {
                origin: "https://example.com",
                "content-type": "application/json",
                ...OWNER_ORG_A,
              },
              body: JSON.stringify({ organizationId: ORG_A_ID }),
            },
          );
          expect(noopRenameGateHit).toBe(true);
          expect(noopWithRename.status).toBe(200);
          const noopRenameBody = (await noopWithRename.json()) as {
            data: { name: string; workspace: { id: string } };
          };
          expect(noopRenameBody.data.name).toBe(`mainnet:${JOB_SHARE_TARGET}`);
          raceReport.inTxNoopConcurrentRename = {
            status: noopWithRename.status,
            returnedName: noopRenameBody.data.name,
          };

          // 2e. Concurrent second move after COMMIT -> 200 with WS_ORG_B (matches origin/main)
          let secondMoveGateHit = false;
          queryGate.active = {
            when: "after",
            match: (text) => /^\s*COMMIT\b/i.test(text),
            run: async () => {
              secondMoveGateHit = true;
              await sideDb.query(
                'UPDATE "public"."Job" SET "workspaceId" = $1::uuid WHERE id = $2',
                [WS_PERSONAL, JOB_WITH_PROJECT],
              );
            },
          };
          const moveWithSecondMove = await world.app.request(
            `https://example.com/v1/jobs/${JOB_WITH_PROJECT}/workspace`,
            {
              method: "PUT",
              headers: {
                origin: "https://example.com",
                "content-type": "application/json",
                ...OWNER_ORG_A,
              },
              body: JSON.stringify({ organizationId: ORG_B_ID }),
            },
          );
          expect(secondMoveGateHit).toBe(true);
          expect(moveWithSecondMove.status).toBe(200);
          const secondMoveBody = (await moveWithSecondMove.json()) as {
            data: { workspace: { id: string } };
          };
          expect(secondMoveBody.data.workspace.id).toBe(WS_ORG_B);
          const storedSecond = await world.shared.job.findUniqueOrThrow({
            where: { id: JOB_WITH_PROJECT },
          });
          expect(storedSecond.workspaceId).toBe(WS_PERSONAL);
          raceReport.inTxConcurrentSecondMove = {
            status: moveWithSecondMove.status,
            returnedWorkspaceId: secondMoveBody.data.workspace.id,
          };

          // 2f. Concurrent Job delete after COMMIT -> 200 with snapshot (matches origin/main), Job deleted in DB
          let deleteGateHit = false;
          let workspaceBeforeDelete: string | null = null;
          coreErrors.length = 0;
          queryGate.active = {
            when: "after",
            match: (text) => /^\s*COMMIT\b/i.test(text),
            run: async () => {
              deleteGateHit = true;
              const { rows } = await sideDb.query<{ workspaceId: string }>(
                'SELECT "workspaceId" FROM "public"."Job" WHERE id = $1',
                [JOB_MOVE_PERSONAL],
              );
              workspaceBeforeDelete = rows[0]?.workspaceId ?? null;
              await sideDb.query('DELETE FROM "public"."Job" WHERE id = $1', [
                JOB_MOVE_PERSONAL,
              ]);
            },
          };
          const moveWithDelete = await world.app.request(
            `https://example.com/v1/jobs/${JOB_MOVE_PERSONAL}/workspace`,
            {
              method: "PUT",
              headers: {
                origin: "https://example.com",
                "content-type": "application/json",
                ...auth(OWNER_ID),
              },
              body: JSON.stringify({ organizationId: ORG_B_ID }),
            },
          );
          expect(deleteGateHit).toBe(true);
          expect(workspaceBeforeDelete).toBe(WS_ORG_B);
          expect(moveWithDelete.status).toBe(200);
          const moveDelBody = (await moveWithDelete.json()) as {
            data: { workspace: { id: string } };
          };
          expect(moveDelBody.data.workspace.id).toBe(WS_ORG_B);
          expect(coreErrors).toEqual([]);
          expect(
            await world.shared.job.findUnique({
              where: { id: JOB_MOVE_PERSONAL },
            }),
          ).toBeNull();
          raceReport.inTxConcurrentDelete = {
            status: moveWithDelete.status,
            workspaceCommittedBeforeDelete: workspaceBeforeDelete,
            returnedWorkspaceId: moveDelBody.data.workspace.id,
            errorLogs: coreErrors.length,
          };
        } finally {
          queryGate.active = null;
          await sideDb.end();
          await world.drop();
        }
      }

      // 2g. PATCH /v1/jobs/:id gated at COMMIT with ticket 26 prepareTasksForUserDeletion on creator
      {
        const world = await buildWorld({ preprodOn: false });
        try {
          let patchCreatorGateHit = false;
          queryGate.active = {
            when: "after",
            match: (text) => /^\s*COMMIT\b/i.test(text),
            run: async () => {
              patchCreatorGateHit = true;
              await world.prepareTasksForUserDeletion(MEMBER_ID, world.shared);
            },
          };
          const patchRes = await world.app.request(
            `https://example.com/v1/jobs/${JOB_STANDALONE}`,
            {
              method: "PATCH",
              headers: {
                origin: "https://example.com",
                "content-type": "application/json",
                ...OWNER_ORG_A,
              },
              body: JSON.stringify({ name: "Renamed While Creator Removed" }),
            },
          );
          expect(patchCreatorGateHit).toBe(true);
          expect(patchRes.status).toBe(200);
          const patchBody = (await patchRes.json()) as {
            data: {
              name: string;
              creator: { type: string; id: string } | null;
            };
          };
          expect(patchBody.data.name).toBe("Renamed While Creator Removed");
          expect(patchBody.data.creator).toMatchObject({
            type: "user",
            id: MEMBER_ID,
          });
          const storedPatchJob = await world.shared.job.findUniqueOrThrow({
            where: { id: JOB_STANDALONE },
          });
          expect(storedPatchJob.name).toBe("Renamed While Creator Removed");
          expect(storedPatchJob.creatorUserId).toBeNull();
          raceReport.inTxPatchCreatorDelete = {
            status: patchRes.status,
            creatorId: patchBody.data.creator?.id ?? null,
            storedName: storedPatchJob.name,
            storedCreatorUserId: storedPatchJob.creatorUserId,
          };
        } finally {
          queryGate.active = null;
          await world.drop();
        }
      }

      // 3. Concurrent Task archive vs PATCH /v1/jobs/:id & PUT /v1/tasks/:id/workspace (both orders)
      for (const order of ["archiveFirst", "writeFirst"] as const) {
        const world = await buildWorld({ preprodOn: false });
        try {
          if (order === "archiveFirst") {
            const gate = holdCommit("archiver", 1);
            let reached = false;
            const pArch = inFlow(
              "archiver",
              async () =>
                await world.app.request(
                  `https://example.com/v1/tasks/${TASK_PUBLIC}`,
                  {
                    method: "DELETE",
                    headers: { origin: "https://example.com", ...OWNER_ORG_A },
                  },
                ),
            );
            await gate.reached;
            reached = true;
            const pPatch = inFlow(
              "patcher",
              async () =>
                await world.app.request(
                  `https://example.com/v1/jobs/${JOB_PUBLIC_TASK}`,
                  {
                    method: "PATCH",
                    headers: {
                      origin: "https://example.com",
                      "content-type": "application/json",
                      ...OWNER_ORG_A,
                    },
                    body: JSON.stringify({ name: "Race Patch" }),
                  },
                ),
            );
            await new Promise((r) => setTimeout(r, 60));
            gate.release();
            const [rArch, rPatch] = await Promise.all([pArch, pPatch]);
            expect(reached).toBe(true);
            expect(rArch.status).toBe(200);
            expect([200, 404]).toContain(rPatch.status);
            raceReport[`taskArchive_${order}`] = {
              archiveStatus: rArch.status,
              patchStatus: rPatch.status,
            };
          } else {
            const gate = holdCommit("taskMover", 1);
            let reached = false;
            const pMove = inFlow(
              "taskMover",
              async () =>
                await world.app.request(
                  `https://example.com/v1/tasks/${TASK_MOVABLE}/workspace`,
                  {
                    method: "PUT",
                    headers: {
                      origin: "https://example.com",
                      "content-type": "application/json",
                      ...OWNER_ORG_A,
                    },
                    body: JSON.stringify({ organizationId: ORG_B_ID }),
                  },
                ),
            );
            await gate.reached;
            reached = true;
            const pArch = inFlow(
              "archiver",
              async () =>
                await world.app.request(
                  `https://example.com/v1/tasks/${TASK_MOVABLE}`,
                  {
                    method: "DELETE",
                    headers: { origin: "https://example.com", ...OWNER_ORG_A },
                  },
                ),
            );
            await new Promise((r) => setTimeout(r, 60));
            gate.release();
            const [rMove, rArch] = await Promise.all([pMove, pArch]);
            expect(reached).toBe(true);
            expect([200, 404, 409]).toContain(rMove.status);
            expect([200, 404, 409]).toContain(rArch.status);
            raceReport[`taskArchive_${order}`] = {
              moveStatus: rMove.status,
              archiveStatus: rArch.status,
            };
          }
        } finally {
          await world.drop();
        }
      }

      // 4. Ticket 26: personal workspace deletion vs Job move into personal workspace (both orders)
      for (const order of ["moveFirst", "deleteFirst"] as const) {
        const world = await buildWorld({ preprodOn: false });
        try {
          // Clear existing items in WS_PERSONAL so deletePersonalWorkspace can delete it if empty
          await world.shared.job.updateMany({
            where: { creatorSokoBotId: BOT_PERSONAL },
            data: { creatorSokoBotId: null },
          });
          await world.shared.job.deleteMany({
            where: { workspaceId: WS_PERSONAL },
          });
          await world.shared.task.deleteMany({
            where: { workspaceId: WS_PERSONAL },
          });
          await world.shared.sokoBot.deleteMany({
            where: { workspaceId: WS_PERSONAL },
          });
          await world.shared.vendorGrant.deleteMany({
            where: { workspaceId: WS_PERSONAL },
          });

          if (order === "moveFirst") {
            const gate = holdCommit("jobMove", 1);
            let reached = false;
            const pMove = inFlow(
              "jobMove",
              async () =>
                await world.app.request(
                  `https://example.com/v1/jobs/${JOB_STANDALONE}/workspace`,
                  {
                    method: "PUT",
                    headers: {
                      origin: "https://example.com",
                      "content-type": "application/json",
                      ...OWNER_ORG_A,
                    },
                    body: JSON.stringify({ organizationId: null }),
                  },
                ),
            );
            await gate.reached;
            reached = true;
            const pDel = inFlow("delPersonalWs", async () => {
              try {
                await world.deletePersonalWorkspace(OWNER_ID);
                return { ok: true, status: 200 };
              } catch (e) {
                return {
                  ok: false,
                  status: (e as { status?: number }).status ?? 500,
                };
              }
            });
            await new Promise((r) => setTimeout(r, 60));
            gate.release();
            const [rMove, rDel] = await Promise.all([pMove, pDel]);
            expect(reached).toBe(true);
            expect([200, 404, 409]).toContain(rMove.status);
            expect([200, 409]).toContain(rDel.status);
            // Invariant: never both succeeded leaving Job on deleted workspace
            const ws = await world.shared.workspace.findUnique({
              where: { id: WS_PERSONAL },
            });
            const job = await world.shared.job.findUniqueOrThrow({
              where: { id: JOB_STANDALONE },
            });
            if (!ws) expect(job.workspaceId).not.toBe(WS_PERSONAL);
            raceReport[`personalWsDelete_${order}`] = {
              moveStatus: rMove.status,
              deleteStatus: rDel.status,
            };
          } else {
            const gate = holdCommit("delPersonalWs", 1);
            let reached = false;
            const pDel = inFlow("delPersonalWs", async () => {
              try {
                await world.deletePersonalWorkspace(OWNER_ID);
                return { ok: true, status: 200 };
              } catch (e) {
                return {
                  ok: false,
                  status: (e as { status?: number }).status ?? 500,
                };
              }
            });
            await gate.reached;
            reached = true;
            const pMove = inFlow(
              "jobMove",
              async () =>
                await world.app.request(
                  `https://example.com/v1/jobs/${JOB_STANDALONE}/workspace`,
                  {
                    method: "PUT",
                    headers: {
                      origin: "https://example.com",
                      "content-type": "application/json",
                      ...OWNER_ORG_A,
                    },
                    body: JSON.stringify({ organizationId: null }),
                  },
                ),
            );
            await new Promise((r) => setTimeout(r, 60));
            gate.release();
            const [rDel, rMove] = await Promise.all([pDel, pMove]);
            expect(reached).toBe(true);
            expect([200, 409]).toContain(rDel.status);
            expect([200, 404, 409]).toContain(rMove.status);
            const ws = await world.shared.workspace.findUnique({
              where: { id: WS_PERSONAL },
            });
            const job = await world.shared.job.findUniqueOrThrow({
              where: { id: JOB_STANDALONE },
            });
            if (!ws) expect(job.workspaceId).not.toBe(WS_PERSONAL);
            raceReport[`personalWsDelete_${order}`] = {
              deleteStatus: rDel.status,
              moveStatus: rMove.status,
            };
          }
        } finally {
          await world.drop();
        }
      }

      // 5. Ticket 26: org/workspace/project deletion & user deletion vs Job writes (both orders)
      for (const order of ["deleteFirst", "writeFirst"] as const) {
        const world = await buildWorld({ preprodOn: false });
        try {
          // Prepare deletable Org B (clear nothing blocking, add a Job in Org B)
          const orgBJob = "jw-job-org-b-del";
          const orgBProj = "25300000-0000-4000-8000-000000000098";
          await world.shared.project.create({
            data: { id: orgBProj, workspaceId: WS_ORG_B, name: "Org B Proj" },
          });
          await world.shared.job.create({
            data: {
              id: orgBJob,
              ownerId: OWNER_ID,
              organizationId: ORG_B_ID,
              workspaceId: WS_ORG_B,
              agentId: AGENT_ID,
              agentJobId: "del-job-1",
              jobType: "FREE",
              createdAt: CLOCK,
              updatedAt: CLOCK,
            },
          });
          await world.shared.member.update({
            where: { id: "jw-m-owner-b" },
            data: { role: "owner" },
          });
          await world.shared.member.deleteMany({
            where: {
              organizationId: ORG_B_ID,
              userId: { not: OWNER_ID },
            },
          });

          if (order === "deleteFirst") {
            // Empty WS_ORG_B (only orgBProj, no Jobs) so prepareOrganizationForDeletion reaches COMMIT
            await world.shared.job.delete({ where: { id: orgBJob } });
            const gate = holdCommit("orgDel", 1);
            let reached = false;
            const pDel = inFlow("orgDel", async () => {
              try {
                await world.prepareOrganizationForDeletion(
                  ORG_B_ID,
                  OWNER_ID,
                  world.shared,
                );
                return { ok: true };
              } catch (e) {
                return { ok: false, err: String(e) };
              }
            });
            await Promise.race([
              gate.reached,
              pDel.then((r) => {
                throw new Error(
                  `orgDel finished before COMMIT: ${JSON.stringify(r)}`,
                );
              }),
            ]);
            reached = true;
            const pMove = inFlow(
              "jobMoveIntoDelB",
              async () =>
                await world.app.request(
                  `https://example.com/v1/jobs/${JOB_STANDALONE}/workspace`,
                  {
                    method: "PUT",
                    headers: {
                      origin: "https://example.com",
                      "content-type": "application/json",
                      ...OWNER_ORG_A,
                    },
                    body: JSON.stringify({ organizationId: ORG_B_ID }),
                  },
                ),
            );
            const pLink = inFlow(
              "projLinkDelB",
              async () =>
                await world.app.request(
                  `https://example.com/v1/projects/${orgBProj}/jobs`,
                  {
                    method: "POST",
                    headers: {
                      origin: "https://example.com",
                      "content-type": "application/json",
                      ...auth(OWNER_ID),
                      "X-Organization-Slug": ORG_B_ID,
                    },
                    body: JSON.stringify({ jobId: JOB_STANDALONE }),
                  },
                ),
            );
            await new Promise((r) => setTimeout(r, 60));
            gate.release();
            const [rDel, rMove, rLink] = await Promise.all([
              pDel,
              pMove,
              pLink,
            ]);
            expect(reached).toBe(true);
            expect(rDel.ok).toBe(true);
            expect([403, 404, 409]).toContain(rMove.status);
            expect([403, 404, 409]).toContain(rLink.status);
            raceReport[`orgDeleteVsWrites_${order}`] = {
              orgDel: rDel.ok,
              moveStatus: rMove.status,
              linkStatus: rLink.status,
            };
          } else {
            await world.shared.job.delete({ where: { id: orgBJob } });
            const gate = holdCommit("jobMoveIntoB", 1);
            let reached = false;
            const pMove = inFlow(
              "jobMoveIntoB",
              async () =>
                await world.app.request(
                  `https://example.com/v1/jobs/${JOB_STANDALONE}/workspace`,
                  {
                    method: "PUT",
                    headers: {
                      origin: "https://example.com",
                      "content-type": "application/json",
                      ...OWNER_ORG_A,
                    },
                    body: JSON.stringify({ organizationId: ORG_B_ID }),
                  },
                ),
            );
            await Promise.race([
              gate.reached,
              pMove.then((r) => {
                throw new Error(
                  `jobMoveIntoB finished before COMMIT: ${r.status}`,
                );
              }),
            ]);
            reached = true;
            const pDel = inFlow("orgDel", async () => {
              try {
                await world.prepareOrganizationForDeletion(
                  ORG_B_ID,
                  OWNER_ID,
                  world.shared,
                );
                return { ok: true };
              } catch (e) {
                return { ok: false, err: String(e) };
              }
            });
            await new Promise((r) => setTimeout(r, 60));
            gate.release();
            const [rMove, rDel] = await Promise.all([pMove, pDel]);
            expect(reached).toBe(true);
            expect([200, 403, 404, 409]).toContain(rMove.status);
            raceReport[`orgDeleteVsMove_${order}`] = {
              moveStatus: rMove.status,
              orgDel: rDel.ok,
            };
          }
        } finally {
          await world.drop();
        }
      }

      // 6. Ticket 26: user deletion (`prepareTasksForUserDeletion`) vs Job PATCH
      {
        const world = await buildWorld({ preprodOn: false });
        try {
          const delUserId = "jw-del-user";
          const delWsId = "25300000-0000-4000-8000-000000000097";
          const delJobId = "jw-del-user-job";
          await world.shared.user.create({
            data: {
              id: delUserId,
              name: "Deletable User",
              email: "del@example.test",
              emailVerified: true,
              termsAccepted: true,
              createdAt: CLOCK,
              updatedAt: CLOCK,
              workspace: { create: { id: delWsId } },
            },
          });
          await world.shared.apikey.create({
            data: {
              id: delUserId,
              referenceId: delUserId,
              key: createHash("sha256").update(delUserId).digest("base64url"),
              enabled: true,
              rateLimitEnabled: false,
              createdAt: CLOCK,
              updatedAt: CLOCK,
            },
          });
          await world.shared.job.create({
            data: {
              id: delJobId,
              ownerId: delUserId,
              workspaceId: delWsId,
              agentId: AGENT_ID,
              agentJobId: "del-user-job-1",
              jobType: "FREE",
              createdAt: CLOCK,
              updatedAt: CLOCK,
            },
          });

          const gate = holdCommit("userDel", 1);
          let reached = false;
          const pDel = inFlow("userDel", async () => {
            await world.prepareTasksForUserDeletion(delUserId, world.shared);
            return true;
          });
          await gate.reached;
          reached = true;
          const pPatch = inFlow(
            "userJobPatch",
            async () =>
              await world.app.request(
                `https://example.com/v1/jobs/${delJobId}`,
                {
                  method: "PATCH",
                  headers: {
                    origin: "https://example.com",
                    "content-type": "application/json",
                    ...auth(delUserId),
                  },
                  body: JSON.stringify({ name: "After User Del" }),
                },
              ),
          );
          await new Promise((r) => setTimeout(r, 60));
          gate.release();
          const [delOk, rPatch] = await Promise.all([pDel, pPatch]);
          expect(reached).toBe(true);
          expect(delOk).toBe(true);
          expect([200, 401, 403, 404]).toContain(rPatch.status);
          raceReport.userDeleteVsPatch = {
            delOk,
            patchStatus: rPatch.status,
          };
        } finally {
          await world.drop();
        }
      }

      // 7. Project deletion (`project.delete`) vs project job link/unlink
      {
        const world = await buildWorld({ preprodOn: false });
        try {
          const gate = holdCommit("projDel", 1);
          let reached = false;
          const pDel = inFlow("projDel", async () => {
            await world.shared.$transaction(async (tx) => {
              await tx.project.delete({ where: { id: PROJ_A2 } });
            });
            return true;
          });
          await gate.reached;
          reached = true;
          const pLink = inFlow(
            "projLinkRace",
            async () =>
              await world.app.request(
                `https://example.com/v1/projects/${PROJ_A2}/jobs`,
                {
                  method: "POST",
                  headers: {
                    origin: "https://example.com",
                    "content-type": "application/json",
                    ...OWNER_ORG_A,
                  },
                  body: JSON.stringify({ jobId: JOB_STANDALONE }),
                },
              ),
          );
          await new Promise((r) => setTimeout(r, 60));
          gate.release();
          const [delOk, rLink] = await Promise.all([pDel, pLink]);
          expect(reached).toBe(true);
          expect(delOk).toBe(true);
          // If project.delete commits between project.findFirst and job.update,
          // PostgreSQL refuses the link (FK / placement trigger -> 500, same as
          // origin/main) and never leaves a Job referencing the deleted Project.
          expect([200, 404, 409, 500]).toContain(rLink.status);
          const jobAfterProjDel = await world.shared.job.findUniqueOrThrow({
            where: { id: JOB_STANDALONE },
            select: { projectId: true },
          });
          expect(jobAfterProjDel.projectId).not.toBe(PROJ_A2);
          raceReport.projectDeleteVsLink = {
            delOk,
            linkStatus: rLink.status,
            jobProjectIdAfter: jobAfterProjDel.projectId,
          };
        } finally {
          await world.drop();
        }
      }

      if (raceTracePath) {
        writeFileSync(
          raceTracePath,
          `${JSON.stringify(raceReport, null, 2)}\n`,
        );
      }
    });
  },
);

describe.runIf(enabled && onSplitLayout)(
  "Job writes over PostgreSQL — split layout (Preprod on)",
  () => {
    let world: World;

    beforeAll(async () => {
      world = await buildWorld({ preprodOn: true });
    }, 60_000);

    afterAll(async () => {
      if (world) await world.drop();
    }, 30_000);

    it("isolates all 4 moved Job writes across equal-id mainnet and preprod Jobs, routes seller by Network, enforces parked-Task & work-right checks, and preserves condition (i) readback", {
      timeout: 60_000,
    }, async () => {
      const names = testSchemaNames();
      const mainnetBefore = await snapshotSchemaJobs(
        world.shared,
        names.DATABASE_SCHEMA_MAINNET,
      );
      let preprodJobs = (
        await snapshotSchemaJobs(world.shared, names.DATABASE_SCHEMA_PREPROD)
      ).jobs;
      const assertPreprodJobDiff = async (
        changesById: Record<string, Record<string, unknown>>,
        label: string,
      ) => {
        const after = (
          await snapshotSchemaJobs(world.shared, names.DATABASE_SCHEMA_PREPROD)
        ).jobs;
        expectOnlyJobRowsChanged(preprodJobs, after, changesById, label);
        preprodJobs = after;
      };

      // 1. Access checks on Preprod (owner is MEMBER_ID on Preprod, OWNER_ID on Mainnet)
      const wrongOwnerPreprod = await runCase(
        world,
        "POST",
        `/v1/jobs/${JOB_STANDALONE}/inputs`,
        PP_OWNER_ORG_A,
        {
          eventId: `evt-await-${JOB_STANDALONE}`,
          inputData: { answer: "wrong-owner" },
        },
        "preprod",
      );
      expect(wrongOwnerPreprod.status).toBe(403);
      expect(wrongOwnerPreprod.sellerCalls).toHaveLength(0);
      await assertPreprodJobDiff({}, "preprod input wrong owner");

      // Parked-Task check on Preprod (kills mutation 2)
      const parkedPreprod = await runCase(
        world,
        "POST",
        `/v1/jobs/${JOB_PARKED_TASK}/inputs`,
        PP_MEMBER_ORG_A,
        {
          eventId: `evt-await-${JOB_PARKED_TASK}`,
          inputData: { answer: "parked" },
        },
        "preprod",
      );
      expect(parkedPreprod.status).toBe(403);
      expect(JSON.parse(parkedPreprod.body)).toMatchObject({
        kind: "task_parked",
      });
      expect(parkedPreprod.sellerCalls).toHaveLength(0);

      // Work-right check on Preprod: unseated member cannot edit unowned Job; plain member cannot manage unowned Job (kills mutation 3)
      const unseatedEdit = await runCase(
        world,
        "POST",
        `/v1/jobs/${JOB_NO_OWNER}/inputs`,
        preprodAuth(UNSEATED_ID),
        {
          eventId: `evt-await-${JOB_NO_OWNER}`,
          inputData: { answer: "unseated" },
        },
        "preprod",
      );
      expect(unseatedEdit.status).toBe(403);
      expect(unseatedEdit.sellerCalls).toHaveLength(0);

      const memberManage = await runCase(
        world,
        "PUT",
        `/v1/jobs/${JOB_NO_OWNER_MOVE}/workspace`,
        PP_MEMBER_ORG_A,
        { organizationId: ORG_B_ID },
        "preprod",
      );
      expect(memberManage.status).toBe(403);

      // 2. POST /v1/jobs/:id/inputs on Preprod -> calls Preprod seller URL, writes only to preprod.jobInput (kills mutation 6)
      const inputPreprod = await runCase(
        world,
        "POST",
        `/v1/jobs/${JOB_STANDALONE}/inputs`,
        PP_MEMBER_ORG_A,
        { eventId: `evt-await-${JOB_STANDALONE}`, inputData: { answer: "pp" } },
        "preprod",
      );
      const preprodAfterInput = await snapshotSchemaJobs(
        world.shared,
        names.DATABASE_SCHEMA_PREPROD,
      );
      assertJobInputWrite({
        label: "split preprod input",
        schema: names.DATABASE_SCHEMA_PREPROD,
        res: inputPreprod,
        expectedEventId: `evt-await-${JOB_STANDALONE}`,
        expectedInputData: { answer: "pp" },
        expectedClock: WRITE_CLOCK,
        storedRows: preprodAfterInput.jobInputs,
      });
      expect(inputPreprod.sellerCalls).toHaveLength(1);
      expect(inputPreprod.sellerCalls[0]?.agent.apiBaseUrl).toBe(
        "https://seller.preprod.example.test",
      );
      await assertPreprodJobDiff({}, "preprod input leaves Job unchanged");

      // 3. POST /v1/projects/:id/jobs & DELETE /v1/projects/:id/jobs/:jobId on Preprod
      // Private task owned by OWNER_ID is hidden from MEMBER_ID
      const privLinkDenied = await runCase(
        world,
        "POST",
        `/v1/projects/${PROJ_A1}/jobs`,
        PP_MEMBER_ORG_A,
        { jobId: JOB_PRIVATE_TASK },
        "preprod",
      );
      expect(privLinkDenied.status).toBe(404);

      const linkPreprod = await runCase(
        world,
        "POST",
        `/v1/projects/${PROJ_A1}/jobs`,
        PP_MEMBER_ORG_A,
        { jobId: JOB_STANDALONE },
        "preprod",
      );
      expect(linkPreprod.status, linkPreprod.body).toBe(200);
      await assertPreprodJobDiff(
        { [JOB_STANDALONE]: { projectId: PROJ_A1, updatedAt: WRITE_CLOCK } },
        "preprod project link",
      );

      const unlinkClock = new Date("2026-11-28T14:00:00.000Z");
      const unlinkPreprod = await runCase(
        world,
        "DELETE",
        `/v1/projects/${PROJ_A1}/jobs/${JOB_STANDALONE}`,
        PP_MEMBER_ORG_A,
        undefined,
        "preprod",
        { clock: unlinkClock },
      );
      expect(unlinkPreprod.status, unlinkPreprod.body).toBe(200);
      await assertPreprodJobDiff(
        { [JOB_STANDALONE]: { projectId: null, updatedAt: unlinkClock } },
        "preprod project unlink",
      );

      // 4. PUT /v1/jobs/:id/workspace on Preprod — condition (i): ADMIN_ID (org A admin, plain member in org B) moves unowned Preprod Job
      const moveNoOwnerPreprod = await runCase(
        world,
        "PUT",
        `/v1/jobs/${JOB_NO_OWNER_MOVE}/workspace`,
        PP_ADMIN_ORG_A,
        { organizationId: ORG_B_ID },
        "preprod",
      );
      expect(moveNoOwnerPreprod.status, moveNoOwnerPreprod.body).toBe(200);
      expect(JSON.parse(moveNoOwnerPreprod.body).data).toMatchObject({
        id: JOB_NO_OWNER_MOVE,
        workspace: { id: WS_ORG_B },
        share: null,
      });
      await assertPreprodJobDiff(
        {
          [JOB_NO_OWNER_MOVE]: {
            workspaceId: WS_ORG_B,
            projectId: null,
            updatedAt: WRITE_CLOCK,
          },
        },
        "preprod move unowned job",
      );

      // Mainnet schema is 100% UNTOUCHED after every single Preprod write!
      const mainnetAfterPreprod = await snapshotSchemaJobs(
        world.shared,
        names.DATABASE_SCHEMA_MAINNET,
      );
      expect(mainnetAfterPreprod).toEqual(mainnetBefore);

      // Now verify Mainnet POST /inputs calls Mainnet seller URL and binds/stores exact timestamps
      const inputMainnet = await runCase(
        world,
        "POST",
        `/v1/jobs/${JOB_STANDALONE}/inputs`,
        OWNER_ORG_A,
        { eventId: `evt-await-${JOB_STANDALONE}`, inputData: { answer: "mn" } },
        "mainnet",
      );
      const mainnetAfterInput = await snapshotSchemaJobs(
        world.shared,
        names.DATABASE_SCHEMA_MAINNET,
      );
      assertJobInputWrite({
        label: "split mainnet input",
        schema: names.DATABASE_SCHEMA_MAINNET,
        res: inputMainnet,
        expectedEventId: `evt-await-${JOB_STANDALONE}`,
        expectedInputData: { answer: "mn" },
        expectedClock: WRITE_CLOCK,
        storedRows: mainnetAfterInput.jobInputs,
      });
      expect(inputMainnet.sellerCalls).toHaveLength(1);
      expect(inputMainnet.sellerCalls[0]?.agent.apiBaseUrl).toBe(
        "https://seller.mainnet.example.test",
      );
    });

    it.each(["mainnet", "preprod"] as const)(
      "holds the %s Job projection inside the no-op Task Workspace transaction",
      { timeout: 30_000 },
      async (network) => {
        expectCoreLog("error", "Kept a database schema mismatch out of Sentry");
        const locker = new Client({ connectionString: world.database.url });
        const observer = new Client({ connectionString: world.database.url });
        await locker.connect();
        await observer.connect();
        try {
          const names = testSchemaNames();
          const schema =
            network === "mainnet"
              ? names.DATABASE_SCHEMA_MAINNET
              : names.DATABASE_SCHEMA_PREPROD;
          await locker.query("BEGIN");
          await locker.query(
            `LOCK TABLE "${schema}"."Job" IN ACCESS EXCLUSIVE MODE`,
          );
          const [{ pid: blocker }] = (
            await locker.query("SELECT pg_backend_pid() AS pid")
          ).rows;
          const request = runCase(
            world,
            "PUT",
            `/v1/tasks/${TASK_MOVABLE}/workspace`,
            network === "mainnet" ? OWNER_ORG_A : PP_OWNER_ORG_A,
            { organizationId: ORG_A_ID },
            network,
            { snapshot: false },
          );
          let blockedQuery: string | undefined;
          for (let attempt = 0; attempt < 80; attempt++) {
            const { rows } = await observer.query<{ query: string }>(
              "SELECT query FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
              [blocker],
            );
            blockedQuery = rows[0]?.query;
            if (blockedQuery !== undefined) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          await locker.query("ROLLBACK");
          const answer = await request;
          expect(blockedQuery).toBeDefined();
          expect(answer.status, answer.body).toBe(500);
          expect(answer.publishedInvalidations).toEqual([]);
          const read = answer.statements.find(
            ({ text }) => text === blockedQuery,
          );
          expect(read).toBeDefined();
          const tx = answer.statements.filter(
            ({ connection }) => connection === read?.connection,
          );
          expect(tx.map(({ text }) => text)).toContain(
            "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
          );
          expect(tx.at(-1)?.text).toBe("ROLLBACK");
        } finally {
          await locker.end();
          await observer.end();
        }
      },
    );

    it("moves a Task's Jobs across BOTH mainnet and preprod atomically and rolls both back if the second update fails", {
      timeout: 30_000,
    }, async () => {
      const mainnetDb = world.createNetworkScope("mainnet").networkDb;
      const preprodDb = world.createNetworkScope("preprod").networkDb;

      // First prove rollback when the second Network update fails (kills mutation 5)
      await expect(
        world.serializableTransaction(async (tx) => {
          await tx.task.update({
            where: { id: TASK_MOVABLE },
            data: { workspaceId: WS_ORG_B, projectId: null },
          });
          let calls = 0;
          const origExecute = tx.$executeRaw.bind(tx);
          const wrappedTx = new Proxy(tx, {
            get(target, prop, receiver) {
              if (prop === "$executeRaw") {
                return (...args: Parameters<typeof origExecute>) => {
                  calls += 1;
                  if (calls === 2) {
                    return Promise.reject(
                      new Error("Injected second-network failure"),
                    );
                  }
                  return origExecute(...args);
                };
              }
              return Reflect.get(target, prop, receiver);
            },
          });
          await world.moveTaskJobs(wrappedTx, TASK_MOVABLE, WS_ORG_B);
        }, "conflict"),
      ).rejects.toThrow("Injected second-network failure");

      // Neither Task nor Mainnet Job nor Preprod Job changed!
      const [taskAfterFail, mnAfterFail, ppAfterFail] = await Promise.all([
        world.shared.task.findUniqueOrThrow({ where: { id: TASK_MOVABLE } }),
        mainnetDb.job.findUniqueOrThrow({ where: { id: JOB_MOVABLE_TASK } }),
        preprodDb.job.findUniqueOrThrow({ where: { id: JOB_MOVABLE_TASK } }),
      ]);
      expect(taskAfterFail.workspaceId).toBe(WS_ORG_A);
      expect(mnAfterFail.workspaceId).toBe(WS_ORG_A);
      expect(mnAfterFail.projectId).toBe(PROJ_A1);
      expect(ppAfterFail.workspaceId).toBe(WS_ORG_A);
      expect(ppAfterFail.projectId).toBe(PROJ_A1);

      // Also prove a rollback AFTER moveTaskJobs rolls back BOTH Networks (catches any update run outside tx)
      await expect(
        world.serializableTransaction(async (tx) => {
          await tx.task.update({
            where: { id: TASK_MOVABLE },
            data: { workspaceId: WS_ORG_B, projectId: null },
          });
          await world.moveTaskJobs(tx, TASK_MOVABLE, WS_ORG_B);
          throw new Error("Rollback after moveTaskJobs");
        }, "conflict"),
      ).rejects.toThrow("Rollback after moveTaskJobs");

      const [mnAfterRollback, ppAfterRollback] = await Promise.all([
        mainnetDb.job.findUniqueOrThrow({ where: { id: JOB_MOVABLE_TASK } }),
        preprodDb.job.findUniqueOrThrow({ where: { id: JOB_MOVABLE_TASK } }),
      ]);
      expect(mnAfterRollback.workspaceId).toBe(WS_ORG_A);
      expect(ppAfterRollback.workspaceId).toBe(WS_ORG_A);

      // Now run the atomic move for real — BOTH Mainnet and Preprod Jobs move (kills mutation 4)
      const names = testSchemaNames();
      const [mnJobsBefore, ppJobsBefore] = await Promise.all([
        snapshotSchemaJobs(world.shared, names.DATABASE_SCHEMA_MAINNET),
        snapshotSchemaJobs(world.shared, names.DATABASE_SCHEMA_PREPROD),
      ]);
      const moveClock = new Date("2026-11-28T15:00:00.000Z");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(moveClock);
      try {
        await world.serializableTransaction(async (tx) => {
          await tx.task.update({
            where: { id: TASK_MOVABLE },
            data: { workspaceId: WS_ORG_B, projectId: null },
          });
          await world.moveTaskJobs(tx, TASK_MOVABLE, WS_ORG_B);
        }, "conflict");
      } finally {
        vi.useRealTimers();
      }

      const [taskAfterOk, mnJobsAfter, ppJobsAfter] = await Promise.all([
        world.shared.task.findUniqueOrThrow({ where: { id: TASK_MOVABLE } }),
        snapshotSchemaJobs(world.shared, names.DATABASE_SCHEMA_MAINNET),
        snapshotSchemaJobs(world.shared, names.DATABASE_SCHEMA_PREPROD),
      ]);
      expect(taskAfterOk.workspaceId).toBe(WS_ORG_B);
      expectOnlyJobRowsChanged(
        mnJobsBefore.jobs,
        mnJobsAfter.jobs,
        {
          [JOB_MOVABLE_TASK]: {
            workspaceId: WS_ORG_B,
            projectId: null,
            updatedAt: moveClock,
          },
        },
        "split moveTaskJobs mainnet",
      );
      expectOnlyJobRowsChanged(
        ppJobsBefore.jobs,
        ppJobsAfter.jobs,
        {
          [JOB_MOVABLE_TASK]: {
            workspaceId: WS_ORG_B,
            projectId: null,
            updatedAt: moveClock,
          },
        },
        "split moveTaskJobs preprod",
      );
    });

    it("refuses a caller without Preprod access on all 4 moved Job writes with zero Network table locks", {
      timeout: 30_000,
    }, async () => {
      await world.shared.organization.update({
        where: { id: ORG_A_ID },
        data: { preprodEnabled: false },
      });
      try {
        await expectPreprodWriteRefusals(
          world,
          PP_OWNER_ORG_A,
          "preprod_access_required",
        );
      } finally {
        await world.shared.organization.update({
          where: { id: ORG_A_ID },
          data: { preprodEnabled: true },
        });
      }
    });

    it("refuses PUT and DELETE /v1/jobs/:id/share on Preprod with 422 while keeping Mainnet share intact", {
      timeout: 30_000,
    }, async () => {
      const createdMainnetShare = await world.shared.publicShare.create({
        data: {
          jobId: JOB_SHARE_TARGET,
          token: "mainnet-share-intact-token",
          allowSearchIndexing: true,
        },
      });

      for (const [method, body] of [
        ["PUT", { allowSearchIndexing: false }],
        ["DELETE", undefined],
      ] as const) {
        const res = await runCase(
          world,
          method,
          `/v1/jobs/${JOB_SHARE_TARGET}/share`,
          PP_MEMBER_ORG_A,
          body,
          "preprod",
        );
        expect(res.status, `${method} share preprod`).toBe(422);
        expect(JSON.parse(res.body)).toMatchObject({
          kind: "mainnet_only_feature",
        });
      }

      const stillIntact = await world.shared.publicShare.findUnique({
        where: { id: createdMainnetShare.id },
      });
      expect(stillIntact?.token).toBe("mainnet-share-intact-token");
      expect(stillIntact?.allowSearchIndexing).toBe(true);
    });

    it("reads full Job details inside the Serializable tx on split layout (update & no-op, PAID relations, creator delete snapshot)", {
      timeout: 60_000,
    }, async () => {
      const splitWorld = await buildWorld({ preprodOn: true });
      const sideDb = new Client({ connectionString: splitWorld.database.url });
      await sideDb.connect();
      try {
        const mnDb = splitWorld.createNetworkScope("mainnet").networkDb;
        const paidJobId = "jw-split-paid-rich";
        await mnDb.agentMetadataOverride.create({
          data: {
            id: "jw-override-1",
            agentId: AGENT_ID,
            name: "Overridden Agent",
            apiBaseUrl: "https://override.mainnet.example.test",
            createdAt: CLOCK,
            updatedAt: CLOCK,
          },
        });
        await mnDb.transaction.create({
          data: {
            id: "jw-tx-paid-1",
            amount: -50_000_000_000n,
            userId: OWNER_ID,
            organizationId: ORG_A_ID,
            createdAt: CLOCK,
            updatedAt: CLOCK,
          },
        });
        await mnDb.job.create({
          data: {
            id: paidJobId,
            ownerId: OWNER_ID,
            creatorUserId: MEMBER_ID,
            organizationId: ORG_A_ID,
            workspaceId: WS_ORG_A,
            agentId: AGENT_ID,
            agentJobId: "paid-seller-1",
            agentApiBaseUrl: "https://seller.mainnet.example.test",
            agentBlockchainIdentifier: "chain-mainnet",
            jobType: "PAID",
            blockchainIdentifier: "bc-split-paid-1",
            identifierFromPurchaser: "purch-1",
            payByTime: CLOCK,
            submitResultTime: CLOCK,
            unlockTime: CLOCK,
            externalDisputeUnlockTime: CLOCK,
            sellerVkey: "vkey-1",
            transactionId: "jw-tx-paid-1",
            name: "Split Paid Job",
            createdAt: CLOCK,
            updatedAt: CLOCK,
            purchase: {
              create: {
                id: "jw-purch-1",
                externalId: "ext-purch-1",
                onChainStatus: "FUNDS_LOCKED",
                onChainTransactionHash: "0xabc",
                resultHash: "res-hash-1",
                createdAt: CLOCK,
                updatedAt: CLOCK,
              },
            },
            events: {
              create: {
                id: "jw-evt-rich-1",
                status: "COMPLETED",
                result: "# Done",
                inputSchema: '{"input_data":[]}',
                createdAt: CLOCK,
                updatedAt: CLOCK,
                input: {
                  create: {
                    id: "jw-inp-rich-1",
                    input: '{"a":1}',
                    inputHash: "ih-1",
                    signature: "sig-1",
                    createdAt: CLOCK,
                    updatedAt: CLOCK,
                  },
                },
                blobs: {
                  create: {
                    id: "jw-blob-1",
                    sourceUrl: "https://files.example.test/a.txt",
                    fileUrl: "https://cdn.example.test/a.txt",
                    name: "a.txt",
                    mimeType: "text/plain",
                    size: 1234n,
                    status: "READY",
                    createdAt: CLOCK,
                    updatedAt: CLOCK,
                  },
                },
                links: {
                  create: {
                    id: "jw-link-1",
                    url: "https://links.example.test/1",
                    title: "Result Link",
                    createdAt: CLOCK,
                    updatedAt: CLOCK,
                  },
                },
              },
            },
          },
        });
        await splitWorld.shared.publicShare.create({
          data: {
            id: "jw-share-rich-1",
            jobId: paidJobId,
            token: "rich-share-tok",
            allowSearchIndexing: true,
            createdAt: CLOCK,
            updatedAt: CLOCK,
          },
        });

        // No-op move on split layout with concurrent creator deletion inside the tx!
        let splitCreatorGateHit = false;
        queryGate.active = {
          when: "before",
          match: (text, values) =>
            text.includes('FROM "shared"."user"') && values.includes(MEMBER_ID),
          run: async () => {
            splitCreatorGateHit = true;
            await sideDb.query('DELETE FROM "shared"."user" WHERE id = $1', [
              MEMBER_ID,
            ]);
          },
        };
        const noopRes = await runCase(
          splitWorld,
          "PUT",
          `/v1/jobs/${paidJobId}/workspace`,
          OWNER_ORG_A,
          { organizationId: ORG_A_ID },
          "mainnet",
        );
        expect(splitCreatorGateHit).toBe(true);
        expect(noopRes.status, noopRes.body).toBe(200);
        const noopBody = JSON.parse(noopRes.body).data;
        expect(noopBody).toMatchObject({
          id: paidJobId,
          credits: 5,
          onChainStatus: "FUNDS_LOCKED",
          onChainTransactionHash: "0xabc",
          result: "# Done",
          resultHash: "res-hash-1",
          creator: { type: "user", id: MEMBER_ID },
          agent: { id: AGENT_ID, overrideName: "Overridden Agent" },
          share: { token: "rich-share-tok", allowSearchIndexing: true },
          workspace: { id: WS_ORG_A },
        });
        expect(noopBody.events[0].blobs[0]).toMatchObject({
          id: "jw-blob-1",
          size: 1234,
          jobId: paidJobId,
        });
        expect(noopBody.events[0].links[0]).toMatchObject({
          id: "jw-link-1",
          url: "https://links.example.test/1",
          jobId: paidJobId,
        });

        // Update move on split layout: whole-row diff + single-connection Serializable tx + concurrent rename after COMMIT
        const names = testSchemaNames();
        const beforeMove = (
          await snapshotSchemaJobs(
            splitWorld.shared,
            names.DATABASE_SCHEMA_MAINNET,
          )
        ).jobs;
        let splitRenameHit = false;
        queryGate.active = {
          when: "after",
          match: (text) => /^\s*COMMIT\b/i.test(text),
          run: async () => {
            splitRenameHit = true;
            await sideDb.query(
              `UPDATE "${names.DATABASE_SCHEMA_MAINNET}"."Job" SET name = $1 WHERE id = $2`,
              ["Split Renamed After Commit", paidJobId],
            );
          },
        };
        const moveRes = await runCase(
          splitWorld,
          "PUT",
          `/v1/jobs/${paidJobId}/workspace`,
          OWNER_ORG_A,
          { organizationId: ORG_B_ID },
          "mainnet",
        );
        expect(splitRenameHit).toBe(true);
        expect(moveRes.status, moveRes.body).toBe(200);
        const moveBody = JSON.parse(moveRes.body).data;
        expect(moveBody.workspace.id).toBe(WS_ORG_B);
        expect(moveBody.name).toBe("Split Paid Job");
        const afterMove = (
          await snapshotSchemaJobs(
            splitWorld.shared,
            names.DATABASE_SCHEMA_MAINNET,
          )
        ).jobs;
        expectOnlyJobRowsChanged(
          beforeMove,
          afterMove,
          {
            [paidJobId]: {
              workspaceId: WS_ORG_B,
              projectId: null,
              updatedAt: WRITE_CLOCK,
              name: "Split Renamed After Commit",
            },
          },
          "split move rich paid job",
        );
      } finally {
        queryGate.active = null;
        await sideDb.end();
        await splitWorld.drop();
      }
    });

    it("times out POST /v1/jobs/:id/inputs on split layout with 500, 0 seller calls, and 0 inputs when jobEvent is held for 6.3s", {
      timeout: 30_000,
    }, async () => {
      expectCoreLog(
        "warn",
        "Kept a transient external failure out of Sentry",
        1,
      );
      const splitWorld = await buildWorld({ preprodOn: true });
      const names = testSchemaNames();
      const locker = new Client({ connectionString: splitWorld.database.url });
      await locker.connect();
      try {
        await locker.query("BEGIN");
        await locker.query(
          `LOCK TABLE "${names.DATABASE_SCHEMA_PREPROD}"."jobEvent" IN ACCESS EXCLUSIVE MODE`,
        );

        sellerCalls.length = 0;
        const started = Date.now();
        const reqPromise = splitWorld.app.request(
          `https://example.com/v1/jobs/${JOB_STANDALONE}/inputs`,
          {
            method: "POST",
            headers: {
              origin: "https://example.com",
              "content-type": "application/json",
              "X-Sokosumi-Network": "preprod",
              ...PP_MEMBER_ORG_A,
            },
            body: JSON.stringify({
              eventId: `evt-await-${JOB_STANDALONE}`,
              inputData: { answer: "delayed-pp" },
            }),
          },
        );

        let observedWaiting = false;
        const observer = new Client({
          connectionString: splitWorld.database.url,
        });
        await observer.connect();
        try {
          for (let i = 0; i < 60; i++) {
            const { rowCount } = await observer.query(
              `SELECT pid FROM pg_stat_activity
               WHERE datname = current_database()
                 AND cardinality(pg_blocking_pids(pid)) > 0`,
            );
            if (rowCount && rowCount > 0) {
              observedWaiting = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 25));
          }
        } finally {
          await observer.end();
        }
        expect(observedWaiting).toBe(true);

        const remaining = 6_300 - (Date.now() - started);
        if (remaining > 0) {
          await new Promise((r) => setTimeout(r, remaining));
        }
        await locker.query("ROLLBACK");

        const res = await reqPromise;
        expect(res.status).toBe(500);
        expect(sellerCalls).toHaveLength(0);
        const inserted = await splitWorld
          .createNetworkScope("preprod")
          .networkDb.jobInput.findUnique({
            where: { eventId: `evt-await-${JOB_STANDALONE}` },
          });
        expect(inserted).toBeNull();
      } finally {
        await locker.query("ROLLBACK").catch(() => {});
        await locker.end();
        await splitWorld.drop();
      }
    });
  },
);
