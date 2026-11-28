/**
 * Slice 25-3: Job writes that move no money, shared Task move Job update,
 * and refusal of Preprod Job shares.
 *
 * Covers:
 * - Mainnet parity pinned against origin/main (`writes.base.json`) for no header
 *   and `mainnet` header across all actors, statuses, normalized bodies, table
 *   snapshots, seller calls, calendar invalidations, and SQL statements + bound
 *   values (with exact checks for the 3 decided Mainnet differences).
 * - Preprod off (today's layout): 403 `preprod_off` with zero Network table
 *   locks (`EXPLAIN` + `pg_locks`) and zero seller calls on all 5 Job writes;
 *   422 `mainnet_only_feature` on PUT & DELETE `/v1/jobs/:id/share`.
 * - Preprod on (split layout): equal-id isolation across `mainnet` and
 *   `preprod`, per-Network seller dispatch, parked-Task & work-right checks on
 *   Preprod, condition (i) unowned Job move readback without second access check,
 *   atomic dual-Network `moveTaskJobs` (and rollback on second-update failure),
 *   403 `preprod_access_required` with zero Network table locks, and 422 share
 *   refusal on Preprod while Mainnet share stays intact.
 * - `updatedAt` UTC clock pin on raw SQL updates vs Prisma `@updatedAt`.
 * - Gated races: two-movers on `PUT /v1/jobs/:id/workspace`, post-commit
 *   readback races (rename, second move, delete -> 404 with zero error logs),
 *   and ticket 26 deletion interleavings (personal workspace, organization,
 *   user, project, task archive) in both orders through explicit gates.
 */
import "@hono/zod-openapi";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { Prisma } from "@sokosumi/database";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { err, ok } from "neverthrow";
import { Client, type Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copyPostgresTestDatabase } from "@/test/postgres-database-copy";
import {
  holdCommit,
  inFlow,
  nextMillisecond,
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
const postCommitGate = vi.hoisted(() => ({
  onReadback: null as null | (() => Promise<void>),
}));
const coreErrors = vi.hoisted(() => [] as unknown[]);

vi.unmock("@/lib/db/prisma");
vi.mock("@vercel/functions", async (load) => {
  const actual = await load<typeof import("@vercel/functions")>();
  const { observePool } = await import("@/test/spend-comparison");
  return {
    ...actual,
    attachDatabasePool: (pool: Pool) => {
      pools.push(pool);
      observePool(pool);
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
vi.mock("@/helpers/job-detail", async (load) => {
  const actual = await load<typeof import("@/helpers/job-detail")>();
  return {
    ...actual,
    readJobDetailsById: async (
      ...args: Parameters<typeof actual.readJobDetailsById>
    ) => {
      if (postCommitGate.onReadback) {
        const hook = postCommitGate.onReadback;
        postCommitGate.onReadback = null;
        await hook();
      }
      return await actual.readJobDetailsById(...args);
    },
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

function normalizeForDigest(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "<TS>")
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      (m) => (m.startsWith("25300000-") ? m : "<UUID>"),
    )
    .replace(/\\"token\\":\\"[^\\"]+\\"/g, '\\"token\\":\\"<TOKEN>\\"')
    .replace(/\\"id\\":\\"[a-z0-9]{20,}\\"/g, '\\"id\\":\\"<ID>\\"')
    .replace(/"c[a-z0-9]{20,}"/g, '"<CUID>"');
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
      { id: PROJ_A1, workspaceId: WS_ORG_A, name: "Project A1" },
      { id: PROJ_A2, workspaceId: WS_ORG_A, name: "Project A2" },
      { id: PROJ_CMO, workspaceId: WS_ORG_A, name: "CMO Project" },
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
      await Promise.all(pools.splice(0).map((p) => p.end().catch(() => {})));
      await database.drop();
    },
  };
}

type World = Awaited<ReturnType<typeof buildWorld>>;

async function snapshotPublicTables(shared: World["shared"]) {
  const [jobs, jobInputs, tasks, projects, shares] = await Promise.all([
    shared.$queryRawUnsafe<unknown[]>(
      `SELECT id, "ownerId", "creatorUserId", "workspaceId", "projectId", "taskId", name, "updatedAt" FROM "public"."Job" ORDER BY id`,
    ),
    shared.$queryRawUnsafe<unknown[]>(
      `SELECT "eventId", input, "inputHash", signature FROM "public"."jobInput" ORDER BY "eventId"`,
    ),
    shared.$queryRawUnsafe<unknown[]>(
      `SELECT id, "workspaceId", "projectId", "archivedAt" FROM "public"."task" ORDER BY id`,
    ),
    shared.$queryRawUnsafe<unknown[]>(
      `SELECT id, "workspaceId", name FROM "public"."project" ORDER BY id`,
    ),
    shared.$queryRawUnsafe<unknown[]>(
      `SELECT "jobId", "allowSearchIndexing" FROM "public"."jobShare" ORDER BY "jobId"`,
    ),
  ]);
  return { jobs, jobInputs, tasks, projects, shares };
}

async function snapshotSchemaJobs(shared: World["shared"], schema: string) {
  const [jobs, jobInputs] = await Promise.all([
    shared.$queryRawUnsafe<unknown[]>(
      `SELECT id, "ownerId", "workspaceId", "projectId", "taskId", name, "updatedAt" FROM "${schema}"."Job" ORDER BY id`,
    ),
    shared.$queryRawUnsafe<unknown[]>(
      `SELECT "eventId", input, "inputHash", signature FROM "${schema}"."jobInput" ORDER BY "eventId"`,
    ),
  ]);
  return { jobs, jobInputs };
}

async function runCase(
  world: World,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
  network?: string,
  options: { snapshot?: boolean; fakeClock?: boolean } = {},
) {
  sellerCalls.length = 0;
  publishedInvalidations.length = 0;
  const fakeClock = options.fakeClock ?? true;
  if (fakeClock) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(CLOCK);
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
    ["PATCH", `/v1/jobs/${JOB_STANDALONE}`, { name: "Refused" }],
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

describe.runIf(enabled && !onSplitLayout)(
  "Job writes over PostgreSQL — today's layout (Mainnet parity & Preprod off)",
  () => {
    it("matches origin/main across all 122 Mainnet cases (no header and mainnet header)", {
      timeout: 120_000,
    }, async () => {
      const baseline = recording
        ? null
        : (JSON.parse(readFileSync(basePath, "utf8")) as Record<
            string,
            {
              status: number;
              body: string;
              rows: string;
              sellerCalls: unknown[];
              publishedInvalidations: string[];
              statementCount: number;
              statementsOrdered: string;
              statementsWithoutFirstTx: string;
            }
          >);
      const recorded: Record<string, unknown> = {};

      for (const network of [undefined, "mainnet"] as const) {
        const suffix = network ?? "implicit";
        const world = await buildWorld({ preprodOn: false });
        try {
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
            recorded[key] = res;
            if (!baseline) return;

            const expected = baseline[key];
            expect(expected, `missing baseline ${key}`).toBeDefined();
            expect(res.status, key).toBe(expected.status);
            expect(sha256(normalizeForDigest(res.body)), `${key} body`).toBe(
              expected.body,
            );
            expect(sha256(normalizeForDigest(res.rows)), `${key} rows`).toBe(
              expected.rows,
            );
            expect(res.sellerCalls, `${key} sellerCalls`).toEqual(
              expected.sellerCalls,
            );
            expect(res.publishedInvalidations, `${key} invalidations`).toEqual(
              expected.publishedInvalidations,
            );

            const stmts = res.statements.map(({ text, values }) => ({
              text,
              values,
            }));
            const ordered = sha256(normalizeForDigest(stmts));
            if (name.startsWith("input_") && name !== "input_empty_data") {
              // Approved decision (1): drop read-only Read Committed BEGIN/COMMIT.
              expect(stmts.length, `${key} stmt count`).toBe(
                expected.statementCount - 2,
              );
              expect(ordered, `${key} statements after BEGIN/COMMIT drop`).toBe(
                expected.statementsWithoutFirstTx,
              );
            } else if (name.startsWith("move_job_")) {
              // Approved decision (2): same statement count, schema-qualified
              // Job SQL in tx + post-commit readJobDetailsById readback.
              expect(stmts.length, `${key} stmt count`).toBe(
                expected.statementCount,
              );
              const commitIdx = stmts.findIndex((s) => s.text === "COMMIT");
              const selectJobIdx = stmts.findIndex((s) =>
                /SELECT \*\s+FROM "public"\."Job"/i.test(s.text),
              );
              expect(
                selectJobIdx,
                `${key} qualified SELECT Job`,
              ).toBeGreaterThan(-1);
              if (res.status === 200) {
                expect(commitIdx, `${key} has COMMIT`).toBeGreaterThan(-1);
                const readbackIdx = stmts.findIndex(
                  (s, i) =>
                    i > commitIdx && s.text.includes('FROM "public"."Job"'),
                );
                expect(
                  readbackIdx,
                  `${key} post-commit readback`,
                ).toBeGreaterThan(commitIdx);
              }
            } else if (name === "move_task_with_job_to_org_b") {
              // Approved decision (3): exact same count, only Job UPDATE qualified.
              expect(stmts.length, `${key} stmt count`).toBe(
                expected.statementCount,
              );
              expect(
                stmts.some((s) =>
                  /UPDATE "public"\."Job"[\s\S]*WHERE "taskId" = \$3/i.test(
                    s.text,
                  ),
                ),
                `${key} qualified task Job UPDATE`,
              ).toBe(true);
            } else {
              expect(stmts.length, `${key} stmt count`).toBe(
                expected.statementCount,
              );
              expect(ordered, `${key} exact SQL + values + order`).toBe(
                expected.statementsOrdered,
              );
            }
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
          if (baseline) {
            const exp = baseline[`share_put_invalid_header:${suffix}`];
            expect(sha256(normalizeForDigest(invalidHdr.body))).toBe(exp.body);
            expect(
              sha256(
                normalizeForDigest(
                  invalidHdr.statements.map(({ text, values }) => ({
                    text,
                    values,
                  })),
                ),
              ),
            ).toBe(exp.statementsOrdered);
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

      if (rawTracePath) {
        writeFileSync(rawTracePath, `${JSON.stringify(recorded, null, 2)}\n`);
      }
    });

    it("refuses Preprod on all 5 Job writes with zero Network table locks and refuses Preprod Job shares with 422", {
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

    it("proves two-movers race, post-commit readback gates (rename, second move, delete), and ticket 26 deletion interleavings", {
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

      // 2. Post-commit readback gate: concurrent rename, concurrent second move, concurrent delete
      {
        const world = await buildWorld({ preprodOn: false });
        try {
          // 2a. Concurrent rename between COMMIT and readback
          let renameGateHit = false;
          postCommitGate.onReadback = async () => {
            renameGateHit = true;
            const r = await world.app.request(
              `https://example.com/v1/jobs/${JOB_STANDALONE}`,
              {
                method: "PATCH",
                headers: {
                  origin: "https://example.com",
                  "content-type": "application/json",
                  ...OWNER_ORG_A,
                },
                body: JSON.stringify({
                  name: "Renamed Between Commit And Readback",
                }),
              },
            );
            expect(r.status).toBe(200);
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
              body: JSON.stringify({ organizationId: ORG_B_ID }),
            },
          );
          expect(renameGateHit).toBe(true);
          expect(moveWithRename.status).toBe(200);
          const renameBody = (await moveWithRename.json()) as {
            data: { name: string; workspace: { id: string } };
          };
          expect(renameBody.data.workspace.id).toBe(WS_ORG_B);
          expect(renameBody.data.name).toBe(
            "Renamed Between Commit And Readback",
          );
          const storedRename = await world.shared.job.findUniqueOrThrow({
            where: { id: JOB_STANDALONE },
          });
          expect(storedRename.workspaceId).toBe(WS_ORG_B);
          expect(storedRename.name).toBe("Renamed Between Commit And Readback");
          raceReport.postCommitRename = {
            status: moveWithRename.status,
            returnedWorkspaceId: renameBody.data.workspace.id,
            returnedName: renameBody.data.name,
          };

          // 2b. Concurrent second move between COMMIT and readback
          let secondMoveGateHit = false;
          postCommitGate.onReadback = async () => {
            secondMoveGateHit = true;
            const r = await world.app.request(
              `https://example.com/v1/jobs/${JOB_WITH_PROJECT}/workspace`,
              {
                method: "PUT",
                headers: {
                  origin: "https://example.com",
                  "content-type": "application/json",
                  ...OWNER_ORG_A,
                },
                body: JSON.stringify({ organizationId: null }),
              },
            );
            expect(r.status).toBe(200);
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
          expect(secondMoveBody.data.workspace.id).toBe(WS_PERSONAL);
          const storedSecond = await world.shared.job.findUniqueOrThrow({
            where: { id: JOB_WITH_PROJECT },
          });
          expect(storedSecond.workspaceId).toBe(WS_PERSONAL);
          raceReport.postCommitSecondMove = {
            status: moveWithSecondMove.status,
            returnedWorkspaceId: secondMoveBody.data.workspace.id,
          };

          // 2c. Concurrent Job delete between COMMIT and readback -> 404, 0 error logs, move stayed committed
          let deleteGateHit = false;
          let workspaceBeforeDelete: string | null = null;
          coreErrors.length = 0;
          postCommitGate.onReadback = async () => {
            deleteGateHit = true;
            const row = await world.shared.job.findUniqueOrThrow({
              where: { id: JOB_MOVE_PERSONAL },
              select: { workspaceId: true },
            });
            workspaceBeforeDelete = row.workspaceId;
            await world.shared.job.delete({ where: { id: JOB_MOVE_PERSONAL } });
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
          expect(moveWithDelete.status).toBe(404);
          expect(await moveWithDelete.json()).toMatchObject({
            message: "Job not found",
          });
          expect(coreErrors).toEqual([]);
          expect(
            await world.shared.job.findUnique({
              where: { id: JOB_MOVE_PERSONAL },
            }),
          ).toBeNull();
          raceReport.postCommitDelete = {
            status: moveWithDelete.status,
            workspaceCommittedBeforeDelete: workspaceBeforeDelete,
            errorLogs: coreErrors.length,
          };
        } finally {
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

    it("isolates all 5 Job writes across equal-id mainnet and preprod Jobs, routes seller by Network, enforces parked-Task & work-right checks, and preserves condition (i) readback", {
      timeout: 60_000,
    }, async () => {
      const names = testSchemaNames();
      const mainnetBefore = await snapshotSchemaJobs(
        world.shared,
        names.DATABASE_SCHEMA_MAINNET,
      );

      // 1. PATCH /v1/jobs/:id on Preprod (owner is MEMBER_ID on Preprod, OWNER_ID on Mainnet)
      const wrongOwnerPreprod = await runCase(
        world,
        "PATCH",
        `/v1/jobs/${JOB_STANDALONE}`,
        PP_OWNER_ORG_A,
        { name: "Mainnet Owner Rejected" },
        "preprod",
      );
      expect(wrongOwnerPreprod.status).toBe(403);

      const patchPreprod = await runCase(
        world,
        "PATCH",
        `/v1/jobs/${JOB_STANDALONE}`,
        PP_MEMBER_ORG_A,
        { name: "Preprod Renamed" },
        "preprod",
      );
      expect(patchPreprod.status, patchPreprod.body).toBe(200);
      expect(JSON.parse(patchPreprod.body).data).toMatchObject({
        id: JOB_STANDALONE,
        name: "Preprod Renamed",
        share: null,
      });

      // Parked-Task check on Preprod (kills mutation 2)
      const parkedPreprod = await runCase(
        world,
        "PATCH",
        `/v1/jobs/${JOB_PARKED_TASK}`,
        PP_MEMBER_ORG_A,
        { name: "Blocked By Parked Task" },
        "preprod",
      );
      expect(parkedPreprod.status).toBe(403);
      expect(JSON.parse(parkedPreprod.body)).toMatchObject({
        kind: "task_parked",
      });

      // Work-right check on Preprod: unseated member cannot edit unowned Job; plain member cannot manage unowned Job (kills mutation 3)
      const unseatedEdit = await runCase(
        world,
        "PATCH",
        `/v1/jobs/${JOB_NO_OWNER}`,
        preprodAuth(UNSEATED_ID),
        { name: "Unseated Blocked" },
        "preprod",
      );
      expect(unseatedEdit.status).toBe(403);

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
      expect(inputPreprod.status, inputPreprod.body).toBe(201);
      expect(inputPreprod.sellerCalls).toHaveLength(1);
      expect(inputPreprod.sellerCalls[0]?.agent.apiBaseUrl).toBe(
        "https://seller.preprod.example.test",
      );

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

      const unlinkClock = new Date("2026-11-28T14:00:00.000Z");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(unlinkClock);
      let unlinkPreprod: Awaited<ReturnType<typeof runCase>>;
      try {
        unlinkPreprod = await runCase(
          world,
          "DELETE",
          `/v1/projects/${PROJ_A1}/jobs/${JOB_STANDALONE}`,
          PP_MEMBER_ORG_A,
          undefined,
          "preprod",
          { fakeClock: false },
        );
      } finally {
        vi.useRealTimers();
      }
      expect(unlinkPreprod.status, unlinkPreprod.body).toBe(200);
      const ppUnlinked = await world
        .createNetworkScope("preprod")
        .networkDb.job.findUniqueOrThrow({
          where: { id: JOB_STANDALONE },
          select: { projectId: true, updatedAt: true },
        });
      expect(ppUnlinked.projectId).toBeNull();
      expect(ppUnlinked.updatedAt.toISOString()).toBe(
        unlinkClock.toISOString(),
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

      // Mainnet schema is 100% UNTOUCHED after every single Preprod write!
      const mainnetAfterPreprod = await snapshotSchemaJobs(
        world.shared,
        names.DATABASE_SCHEMA_MAINNET,
      );
      expect(mainnetAfterPreprod).toEqual(mainnetBefore);

      // Now verify Mainnet POST /inputs calls Mainnet seller URL
      const inputMainnet = await runCase(
        world,
        "POST",
        `/v1/jobs/${JOB_STANDALONE}/inputs`,
        OWNER_ORG_A,
        { eventId: `evt-await-${JOB_STANDALONE}`, inputData: { answer: "mn" } },
        "mainnet",
      );
      expect(inputMainnet.status, inputMainnet.body).toBe(201);
      expect(inputMainnet.sellerCalls).toHaveLength(1);
      expect(inputMainnet.sellerCalls[0]?.agent.apiBaseUrl).toBe(
        "https://seller.mainnet.example.test",
      );
    });

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

      const [taskAfterOk, mnAfterOk, ppAfterOk] = await Promise.all([
        world.shared.task.findUniqueOrThrow({ where: { id: TASK_MOVABLE } }),
        mainnetDb.job.findUniqueOrThrow({ where: { id: JOB_MOVABLE_TASK } }),
        preprodDb.job.findUniqueOrThrow({ where: { id: JOB_MOVABLE_TASK } }),
      ]);
      expect(taskAfterOk.workspaceId).toBe(WS_ORG_B);
      expect(mnAfterOk.workspaceId).toBe(WS_ORG_B);
      expect(mnAfterOk.projectId).toBeNull();
      expect(mnAfterOk.updatedAt.toISOString()).toBe(moveClock.toISOString());
      expect(ppAfterOk.workspaceId).toBe(WS_ORG_B);
      expect(ppAfterOk.projectId).toBeNull();
      expect(ppAfterOk.updatedAt.toISOString()).toBe(moveClock.toISOString());
    });

    it("refuses a caller without Preprod access on all 5 Job writes with zero Network table locks", {
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
  },
);
