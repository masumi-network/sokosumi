import "@hono/zod-openapi";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { AgentJobStatus, Prisma } from "@sokosumi/database";
import { hashPassword } from "better-auth/crypto";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { Client, type Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copyPostgresTestDatabase } from "@/test/postgres-database-copy";
import { observing } from "@/test/spend-comparison";
import { onSplitLayout } from "@/test/split-layout";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor";
import tableLayout from "../../../../../../packages/database/prisma/network-tables.json";

const pools = vi.hoisted(() => [] as Pool[]);
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
vi.mock("@/lib/drive-blob", async (load) => ({
  ...(await load<typeof import("@/lib/drive-blob")>()),
  driveRead: async (key: string) => ({
    stream: new Response(key).body,
    size: key.length,
    contentType: "text/plain",
  }),
}));

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const recording = process.env.RECORD_JOB_READS_BASE === "true";
const basePath = new URL("./reads.base.json", import.meta.url);
const tracePath = process.env.JOB_READS_TRACE_PATH;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
const clock = new Date("2026-11-28T00:00:00.000Z");
const ownerId = "job-reads-owner";
const memberId = "job-reads-member";
const unoptedId = "job-reads-unopted";
const organizationId = "job-reads-org";
const organizationWorkspace = "25000000-0000-4000-8000-000000000001";
const personalWorkspace = "25000000-0000-4000-8000-000000000002";
const plainWorkspace = "25000000-0000-4000-8000-000000000003";
const family = "25000000-0000-4000-8000-000000000004";
const otherFamily = "25000000-0000-4000-8000-000000000005";
const botId = "25000000-0000-4000-8000-000000000006";
const projectId = "25000000-0000-4000-8000-000000000007";
const agentId = "job-reads-agent";
const twin = "job-reads-twin";
const projectJob = "job-reads-project-job";
const standaloneJob = "job-reads-standalone-job";
const base = `/v1/jobs/${twin}`;
const routes = {
  list: "/v1/jobs?scope=workspace&limit=2",
  agent: `/v1/agents/${agentId}/jobs?scope=workspace&limit=2`,
  task: "/v1/tasks/job-reads-public/jobs",
  detail: base,
  events: `${base}/events`,
  request: `${base}/input-request`,
  files: `${base}/files`,
  content: `${base}/files/job-reads-ready/content`,
  links: `${base}/links`,
};
const auth = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});
const organization = { "X-Organization-Slug": organizationId };
const owner = { ...auth(ownerId), ...organization };
const member = { ...auth(memberId), ...organization };
const personalOwner = auth(ownerId);
const coworker = (kind: string) => ({
  ...auth(`coworker_job_reads_${kind}`),
  "X-Context-User-Id": ownerId,
  "X-Context-Organization-Id": organizationId,
});
const personalCoworker = {
  ...auth("coworker_job_reads_assigned"),
  "X-Context-User-Id": ownerId,
};
const bot = auth("sokoBot_job_reads_personal");

async function setup() {
  const source =
    process.env.POSTGRES_TEST_TEMPLATE_URL ?? process.env.DATABASE_URL;
  if (!source) throw new Error("Job reads need PostgreSQL");
  const database = await copyPostgresTestDatabase(source, "job_reads_test");
  onRelease = database.drop;
  vi.stubEnv("DATABASE_URL", database.url);
  vi.stubEnv("DATABASE_URL_UNPOOLED", database.url);
  vi.stubEnv("NETWORK", "Mainnet");
  vi.stubEnv("NETWORK_PREPROD_ENABLED", onSplitLayout ? "true" : "false");
  const { default: shared } = await import("@/lib/db/prisma");
  const { createNetworkScope } = await import("@/lib/db/network-scope");
  const { createCoreApp, signIn } = await import(
    "@/test-fixtures/core-session"
  );
  const { hashApiKey } = await import("@/lib/coworker-api-key");
  for (const [id, workspace] of [
    [ownerId, personalWorkspace],
    [memberId, null],
    [unoptedId, plainWorkspace],
  ] as const) {
    await shared.user.create({
      data: {
        id,
        name: id,
        email: `${id}@example.test`,
        emailVerified: true,
        termsAccepted: true,
        createdAt: clock,
        updatedAt: clock,
        ...(workspace && { workspace: { create: { id: workspace } } }),
      },
    });
    await shared.apikey.create({
      data: {
        id,
        referenceId: id,
        key: createHash("sha256").update(id).digest("base64url"),
        enabled: true,
        rateLimitEnabled: false,
        createdAt: clock,
        updatedAt: clock,
      },
    });
  }
  await shared.organization.create({
    data: {
      id: organizationId,
      name: "Job reads",
      slug: organizationId,
      preprodEnabled: true,
      createdAt: clock,
      workspace: { create: { id: organizationWorkspace } },
      members: {
        create: [
          {
            id: "job-reads-owner-membership",
            userId: ownerId,
            role: "owner",
            seatAssignedAt: clock,
          },
          {
            id: "job-reads-member-membership",
            userId: memberId,
            role: "member",
            seatAssignedAt: clock,
          },
        ],
      },
    },
  });
  await shared.vendorGrant.createMany({
    data: [organizationWorkspace, personalWorkspace, plainWorkspace].map(
      (workspaceId) => ({
        vendorId: TEST_VENDOR_ID,
        workspaceId,
        permission: "workspace",
        status: "GRANTED",
      }),
    ),
  });
  await shared.vendor.createMany({
    data: [
      { id: family, name: "Family", slug: "job-reads-family" },
      { id: otherFamily, name: "Other", slug: "job-reads-other" },
    ],
  });
  await shared.vendorGrant.create({
    data: {
      vendorId: family,
      workspaceId: personalWorkspace,
      permission: "workspace",
      status: "GRANTED",
    },
  });
  for (const [kind, vendorId] of [
    ["assigned", family],
    ["sibling", family],
    ["outsider", otherFamily],
  ]) {
    const id = `job-reads-${kind}`;
    await shared.coworker.create({
      data: { id, name: id, slug: id, vendorId, capabilities: ["tasks"] },
    });
    const token = `coworker_job_reads_${kind}`;
    await shared.coworkerApiKey.create({
      data: {
        id,
        coworkerId: id,
        keyHash: await hashApiKey(token),
        keyStart: token.slice(0, 12),
        lastUsedAt: clock,
      },
    });
  }
  await shared.sokoBot.create({
    data: { id: botId, userId: ownerId, workspaceId: personalWorkspace },
  });
  const botToken = "sokoBot_job_reads_personal";
  await shared.coworkerApiKey.create({
    data: {
      id: "job-reads-bot",
      sokoBotId: botId,
      keyHash: await hashApiKey(botToken),
      keyStart: botToken.slice(0, 12),
      lastUsedAt: clock,
    },
  });
  await shared.task.createMany({
    data: [
      {
        id: "job-reads-public",
        name: "Public",
        assigneeId: "job-reads-assigned",
      },
      {
        id: "job-reads-private",
        name: "Private",
        visibility: "PRIVATE",
        assigneeId: "job-reads-assigned",
      },
      { id: "job-reads-archived", name: "Archived", archivedAt: clock },
      {
        id: "job-reads-bot-task",
        name: "Personal",
        assigneeSokoBotId: botId,
        workspaceId: personalWorkspace,
        organizationId: null,
      },
      {
        id: "job-reads-plain-task",
        name: "Plain",
        ownerId: unoptedId,
        workspaceId: plainWorkspace,
        organizationId: null,
      },
    ].map((row) => ({
      ownerId,
      organizationId,
      workspaceId: organizationWorkspace,
      status: "READY",
      createdAt: clock,
      updatedAt: clock,
      ...row,
    })) as Prisma.TaskCreateManyInput[],
  });
  await shared.project.create({
    data: { id: projectId, workspaceId: personalWorkspace, name: "Job reads" },
  });

  async function seed(network: "mainnet" | "preprod") {
    const { networkDb } = createNetworkScope(network);
    await networkDb.agent.create({
      data: {
        id: agentId,
        name: network,
        blockchainIdentifier: agentId,
        isShown: true,
        uptimeCount: 0,
        uptimeCheckCount: 0,
        lastUptimeCheck: clock,
        pricing: { create: { id: agentId, pricingType: "FREE" } },
      },
    });
    const preprod = network === "preprod";
    const jobs = [
      {
        ...job(twin, preprod ? memberId : ownerId, "job-reads-public", 4),
        ...(preprod
          ? { creatorSokoBotId: botId }
          : { creatorCoworkerId: "job-reads-assigned" }),
      },
      job(`job-reads-${network}-only`, ownerId, "job-reads-public", 3),
      ...(preprod
        ? []
        : [
            job("job-reads-third", ownerId, "job-reads-public", 3),
            job("job-reads-private-job", ownerId, "job-reads-private", 2),
            job("job-reads-archived-job", ownerId, "job-reads-archived", 1),
            {
              ...job("job-reads-bot-job", ownerId, "job-reads-bot-task", 0),
              organizationId: null,
              workspaceId: personalWorkspace,
              creatorUserId: ownerId,
            },
            {
              ...job(projectJob, ownerId, null, 2),
              organizationId: null,
              workspaceId: personalWorkspace,
              creatorUserId: memberId,
              projectId,
            },
            {
              ...job(standaloneJob, ownerId, null, 1),
              organizationId: null,
              workspaceId: personalWorkspace,
            },
          ]),
    ];
    await networkDb.job.createMany({ data: jobs });
    for (const { id } of jobs) {
      const status: AgentJobStatus =
        id === twin && preprod ? "FAILED" : "COMPLETED";
      await networkDb.jobEvent.create({
        data: {
          id: `${id}-${network}-result`,
          jobId: id,
          status,
          createdAt: clock,
          updatedAt: clock,
          result: `${network} result for ${id}`,
        },
      });
    }
    const eventId = `${twin}-${network}-result`;
    const awaitingJobId = `job-reads-${network}-only`;
    await networkDb.jobEvent.createMany({
      data: [twin, awaitingJobId].map((id) => ({
        id: `${id}-${network}-awaiting`,
        jobId: id,
        status: "AWAITING_INPUT",
        inputSchema: `${network} schema`,
        result: `${network} question`,
        createdAt: new Date(clock.getTime() - 1000),
        updatedAt: clock,
      })),
    });
    await networkDb.jobInput.create({
      data: {
        id: `${network}-input`,
        eventId,
        input: `${network} input`,
        createdAt: clock,
        updatedAt: clock,
      },
    });
    await networkDb.blob.createMany({
      data: [
        {
          id: "job-reads-ready",
          eventId,
          status: "READY",
          fileUrl: `${network} bytes`,
        },
        { id: `${network}-pending`, eventId, status: "PENDING" },
        {
          id: `${network}-exclusive`,
          eventId,
          status: "READY",
          fileUrl: `${network} exclusive`,
        },
        {
          id: `${network}-foreign`,
          eventId: `${awaitingJobId}-${network}-result`,
          status: "READY",
          fileUrl: `${network} foreign`,
        },
      ].map((blob) => ({
        sourceUrl: `https://example.test/${blob.id}`,
        name: `${blob.id}.txt`,
        mimeType: "text/plain",
        createdAt: clock,
        updatedAt: clock,
        ...blob,
      })) as Prisma.BlobCreateManyInput[],
    });
    await networkDb.link.createMany({
      data: [
        {
          id: `${network}-link`,
          eventId,
          url: `https://example.test/${network}`,
          createdAt: clock,
          updatedAt: clock,
        },
        {
          id: `${network}-foreign-link`,
          eventId: `${awaitingJobId}-${network}-result`,
          url: "https://example.test/foreign",
          createdAt: clock,
          updatedAt: clock,
        },
      ],
    });
  }

  function job(
    id: string,
    owner: string,
    taskId: string | null,
    rank: number,
  ): Prisma.JobCreateManyInput & { id: string } {
    return {
      id,
      ownerId: owner,
      organizationId,
      workspaceId: organizationWorkspace,
      taskId,
      agentId,
      agentJobId: id,
      jobType: "FREE",
      name: id,
      createdAt: new Date(clock.getTime() + rank * 1000),
      updatedAt: clock,
    };
  }

  await seed("mainnet");
  await shared.publicShare.create({
    data: {
      id: "job-reads-share",
      token: "job-reads-share-token",
      jobId: twin,
      createdAt: clock,
      updatedAt: clock,
    },
  });
  const core = createCoreApp();
  let session: Record<string, string> = {};
  if (onSplitLayout) {
    await shared.account.create({
      data: {
        userId: ownerId,
        accountId: ownerId,
        providerId: "credential",
        password: await hashPassword("fixture-password-long"),
      },
    });
    session = {
      ...organization,
      cookie: await signIn(core, `${ownerId}@example.test`),
    };
  }
  return {
    app: new Hono().use(requestId()).route("/", core),
    database,
    seed,
    session,
    shared,
    async submitMainnetInput() {
      await createNetworkScope("mainnet").networkDb.jobInput.create({
        data: {
          eventId: `${twin}-mainnet-awaiting`,
          input: "answered on Mainnet",
        },
      });
    },
  };
}

let system: Awaited<ReturnType<typeof setup>>;
let onRelease: (() => Promise<void>) | undefined;
async function call(
  path: string,
  headers: Record<string, string> = owner,
  network?: "mainnet" | "preprod",
) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
  try {
    const { outcome, log } = await observing(async () => {
      const response = await system.app.request(`https://example.com${path}`, {
        headers: {
          origin: "https://example.com",
          "X-Request-Id": "job-reads-test",
          ...headers,
          ...(network && { "X-Sokosumi-Network": network }),
        },
      });
      return { status: response.status, body: await response.text() };
    });
    if ("threw" in outcome) throw new Error(JSON.stringify(outcome.threw));
    return {
      ...outcome,
      statements: log.map(({ text, values }) => ({ text, values })),
    };
  } finally {
    vi.useRealTimers();
  }
}

const cases: Record<string, [string, Record<string, string>, number]> = {
  ...Object.fromEntries(
    Object.entries(routes).map(
      ([name, path]) => [name, [path, owner, 200]] as const,
    ),
  ),
  "member workspace": [routes.list, member, 200],
  "member private Job": ["/v1/jobs/job-reads-private-job", member, 404],
  "member archived Job": ["/v1/jobs/job-reads-archived-job", member, 200],
  "member archived Task": ["/v1/tasks/job-reads-archived/jobs", member, 404],
  "assigned detail": [
    "/v1/jobs/job-reads-private-job",
    coworker("assigned"),
    200,
  ],
  "sibling detail": [
    "/v1/jobs/job-reads-private-job",
    coworker("sibling"),
    200,
  ],
  "outsider detail": [
    "/v1/jobs/job-reads-private-job",
    coworker("outsider"),
    404,
  ],
  "assigned list": [routes.list, coworker("assigned"), 200],
  "sibling list": [routes.list, coworker("sibling"), 200],
  "outsider list": [routes.list, coworker("outsider"), 403],
  "bot detail": ["/v1/jobs/job-reads-bot-job", bot, 200],
  "bot list": [routes.list, bot, 200],
  "next page": [`${routes.list}&cursor=job-reads-third`, owner, 200],
  "event status filter": [`${routes.list}&status=AWAITING_INPUT`, owner, 200],
  "not READY": [`${base}/files/mainnet-pending/content`, owner, 404],
  "file belongs to another Job": [
    `${base}/files/mainnet-foreign/content`,
    owner,
    404,
  ],
  "awaiting event belongs to another Job": [
    "/v1/jobs/job-reads-third/input-request",
    owner,
    404,
  ],
  "personal workspace": [routes.list, personalOwner, 200],
  "standalone detail": [`/v1/jobs/${standaloneJob}`, personalOwner, 200],
  "project filter": [
    `${routes.list}&projectId=${projectId}`,
    personalOwner,
    200,
  ],
  "null project filter": [`${routes.list}&projectId=null`, personalOwner, 200],
  "coworker standalone detail": [
    `/v1/jobs/${standaloneJob}`,
    personalCoworker,
    403,
  ],
  "coworker personal list": [routes.list, personalCoworker, 200],
  "bot standalone detail": [`/v1/jobs/${standaloneJob}`, bot, 403],
};

const mixedReads = {
  projects: "/v1/projects",
  activity: "/v1/projects/activity",
  stats: "/v1/projects/stats",
  attention: `/v1/projects/${projectId}/needs-attention`,
  tasks: "/v1/tasks",
};

async function expectNoNetworkPlans(
  path: string,
  answer: Awaited<ReturnType<typeof call>>,
) {
  const client = new Client({ connectionString: system.database.url });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const statement of answer.statements) {
      await client.query(`EXPLAIN ${statement.text}`, statement.values);
    }
    // PostgreSQL locks referenced tables even if the planner removes a
    // scan. Read those locks before this transaction releases them.
    const { rows } = await client.query(
      `SELECT c.relname
       FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
       WHERE l.pid = pg_backend_pid() AND c.relkind IN ('r', 'p', 'f')
         AND c.relname = ANY($1::text[])`,
      [
        [
          ...Object.values(tableLayout.network),
          ...tableLayout.networkJoinTables,
        ],
      ],
    );
    expect(rows, path).toEqual([]);
  } finally {
    await client.end();
  }
}

async function expectRefusals(
  headers: Record<string, string>,
  kind: "preprod_off" | "preprod_access_required",
) {
  for (const path of Object.values(routes)) {
    const answer = await call(path, headers, "preprod");
    expect(answer.status, `${path}: ${answer.body}`).toBe(403);
    expect(JSON.parse(answer.body), path).toMatchObject({ kind });
    await expectNoNetworkPlans(path, answer);
  }
}

async function expectSharedMixedRead(
  name: keyof typeof mixedReads,
  headers: Record<string, string>,
  network: "mainnet" | "preprod",
) {
  const path = mixedReads[name];
  const answer = await call(path, headers, network);
  expect(answer.status, `${path}: ${answer.body}`).toBe(200);
  const { data } = JSON.parse(answer.body);
  switch (name) {
    case "projects":
      expect(data).toEqual([
        expect.objectContaining({ id: projectId, jobCount: 0 }),
      ]);
      break;
    case "activity":
      expect(data).toEqual([]);
      break;
    case "stats":
      expect(data.projects).toEqual([
        expect.objectContaining({
          projectId,
          jobs: { total: 0, byStatus: [] },
        }),
      ]);
      break;
    case "attention":
      expect(data).toMatchObject({ jobCount: 0, items: [] });
      break;
    case "tasks":
      expect(data).toEqual([
        expect.objectContaining({ id: "job-reads-bot-task", jobsCount: 0 }),
      ]);
      break;
  }
  await expectNoNetworkPlans(path, answer);
}

describe.runIf(enabled)("Job reads over PostgreSQL", () => {
  beforeAll(async () => {
    system = await setup();
  }, 60_000);
  afterAll(async () => {
    try {
      await Promise.all(pools.map((pool) => pool.end()));
    } finally {
      vi.unstubAllEnvs();
      await onRelease?.();
    }
  }, 30_000);

  it.runIf(!onSplitLayout)(
    "matches origin/main, including raw responses, bindings and send order",
    async () => {
      const observed: Record<string, Awaited<ReturnType<typeof call>>> = {};
      for (const [name, [path, headers, status]] of Object.entries(cases)) {
        for (const network of [undefined, "mainnet"] as const) {
          const value = await call(path, headers, network);
          expect(
            value.status,
            `${name} ${network ?? "implicit"}: ${value.body}`,
          ).toBe(status);
          observed[`${name} ${network ?? "implicit"}`] = value;
        }
      }
      if (tracePath) {
        writeFileSync(tracePath, `${JSON.stringify(observed, null, 2)}\n`);
      }
      const evidence = Object.fromEntries(
        Object.entries(observed).map(([name, { status, body, statements }]) => [
          name,
          {
            status,
            body: digest(body),
            count: statements.length,
            ordered: digest(statements),
            parallel: digest(
              statements.map((statement) => JSON.stringify(statement)).sort(),
            ),
          },
        ]),
      );
      if (recording) {
        writeFileSync(basePath, `${JSON.stringify(evidence, null, 2)}\n`);
        return;
      }
      const baseline = JSON.parse(
        readFileSync(basePath, "utf8"),
      ) as typeof evidence;
      expect(Object.keys(evidence)).toEqual(Object.keys(baseline));
      for (const [name, value] of Object.entries(evidence)) {
        const expected = baseline[name];
        if (value.ordered === expected.ordered) {
          expect(value, name).toEqual(expected);
        } else {
          // Prisma sends independent relation queries in parallel. Their
          // relative wire order varies even between two requests to the base.
          expect({ ...value, ordered: undefined }, name).toEqual({
            ...expected,
            ordered: undefined,
          });
        }
      }
    },
    30_000,
  );

  it.runIf(!onSplitLayout)(
    "uses the original Task Job include on today's layout",
    async () => {
      const { createNetworkScope } = await import("@/lib/db/network-scope");
      const { taskJobProjectionInclude, withTaskResponseJobs } = await import(
        "@/helpers/task-job-projection"
      );
      const { taskInclude } = await import("@/types/task");
      const scope = createNetworkScope("mainnet");
      const { outcome, log } = await observing(async () => {
        const task = await system.shared.task.findUniqueOrThrow({
          where: { id: "job-reads-public" },
          include: taskJobProjectionInclude(taskInclude, scope),
        });
        return withTaskResponseJobs(task, scope);
      });
      expect(outcome).toMatchObject({
        jobs: expect.arrayContaining([expect.objectContaining({ id: twin })]),
      });
      // Independent Prisma relation queries can run in either order.
      const statements = log
        .map(({ text, values }) => JSON.stringify({ text, values }))
        .sort();
      expect(digest(statements)).toBe(
        "ed0f9699df0cf3974e25b44d9affb685b92371cc719be6c5ade99671c9eff85c",
      );
    },
  );

  it.runIf(!onSplitLayout && !recording)(
    "refuses Preprod on all nine routes before planning any Network read when off",
    async () => await expectRefusals(owner, "preprod_off"),
    30_000,
  );

  it
    .runIf(!onSplitLayout && !recording)
    .each(Object.keys(mixedReads) as (keyof typeof mixedReads)[])(
    "keeps shared %s when Preprod is off",
    async (name) => expectSharedMixedRead(name, personalOwner, "preprod"),
  );

  describe.runIf(onSplitLayout)("shared, Mainnet and Preprod schemas", () => {
    it("keeps all nine reads isolated with equal Job IDs", async () => {
      const before = new Map<string, string>();
      const baseline = JSON.parse(readFileSync(basePath, "utf8")) as Record<
        string,
        { body: string }
      >;
      for (const [name, [path, headers, status]] of Object.entries(cases)) {
        const answer = await call(path, headers, "mainnet");
        expect(answer.status, `${name}: ${answer.body}`).toBe(status);
        expect(digest(answer.body), name).toBe(
          baseline[`${name} mainnet`].body,
        );
        before.set(name, answer.body);
      }
      await system.seed("preprod");

      for (const [name, [path, headers, status]] of Object.entries(cases)) {
        const answer = await call(path, headers, "mainnet");
        expect(answer.status, name).toBe(status);
        expect(answer.body, name).toBe(before.get(name));
      }

      for (const network of ["mainnet", "preprod"] as const) {
        const preprod = network === "preprod";
        const other = preprod ? "mainnet" : "preprod";
        const responses = new Map<string, Awaited<ReturnType<typeof call>>>();
        for (const [name, path] of Object.entries(routes)) {
          const answer = await call(path, system.session, network);
          expect(answer.status, `${path}: ${answer.body}`).toBe(200);
          responses.set(name, answer);
        }
        const json = (name: string) =>
          JSON.parse(responses.get(name)?.body ?? "");
        for (const name of ["list", "agent"]) {
          const result = json(name);
          expect(result.data.map(({ id }: { id: string }) => id)).toEqual([
            twin,
            preprod ? "job-reads-preprod-only" : "job-reads-third",
          ]);
          expect(result.meta.pagination).toMatchObject({
            total: preprod ? 2 : 5,
            nextCursor: preprod ? null : "job-reads-third",
          });
        }
        expect(
          json("task")
            .data.map(({ id }: { id: string }) => id)
            .sort(),
        ).toEqual(
          [
            twin,
            `job-reads-${network}-only`,
            ...(preprod ? [] : ["job-reads-third"]),
          ].sort(),
        );
        expect(json("detail").data).toMatchObject({
          id: twin,
          ownerId: preprod ? memberId : ownerId,
          status: preprod ? "failed" : "completed",
          agent: { name: network },
          share: preprod ? null : { token: "job-reads-share-token" },
        });
        expect(json("events").data.map(({ id }: { id: string }) => id)).toEqual(
          [`${twin}-${network}-result`, `${twin}-${network}-awaiting`],
        );
        expect(json("events").data[0].input.input).toBe(`${network} input`);
        expect(json("request").data).toMatchObject({
          eventId: `${twin}-${network}-awaiting`,
          inputSchema: `${network} schema`,
        });
        expect(
          json("files")
            .data.map(({ id }: { id: string }) => id)
            .sort(),
        ).toEqual(
          [
            "job-reads-ready",
            `${network}-pending`,
            `${network}-exclusive`,
          ].sort(),
        );
        expect(json("links").data.map(({ id }: { id: string }) => id)).toEqual([
          `${network}-link`,
        ]);
        expect(responses.get("content")?.body).toBe(`${network} bytes`);
        const foreign = await call(
          `${base}/files/${other}-exclusive/content`,
          system.session,
          network,
        );
        expect(foreign.status).toBe(404);

        const one = await call(
          routes.list.replace("limit=2", "limit=1"),
          system.session,
          network,
        );
        expect(one.status).toBe(200);
        expect(one.statements).toHaveLength(
          responses.get("list")?.statements.length ?? 0,
        );
      }
      const preprodList = async (query: string) => {
        const answer = await call(
          `/v1/jobs?${query}`,
          system.session,
          "preprod",
        );
        expect(answer.status, answer.body).toBe(200);
        const { data, meta } = JSON.parse(answer.body);
        return {
          ids: data.map(({ id }: { id: string }) => id),
          total: meta.pagination.total,
          nextCursor: meta.pagination.nextCursor,
        };
      };
      expect(await preprodList("limit=2")).toEqual({
        ids: ["job-reads-preprod-only"],
        total: 1,
        nextCursor: null,
      });
      expect(await preprodList("scope=workspace&status=FAILED")).toEqual({
        ids: [twin],
        total: 1,
        nextCursor: null,
      });
      expect(
        await preprodList(`scope=workspace&limit=1&cursor=${twin}`),
      ).toEqual({
        ids: ["job-reads-preprod-only"],
        total: 2,
        nextCursor: null,
      });
      expect(
        await preprodList("scope=workspace&cursor=job-reads-mainnet-only"),
      ).toEqual({
        ids: [],
        total: 2,
        nextCursor: null,
      });
      await system.submitMainnetInput();
      expect(
        (await call(routes.request, system.session, "mainnet")).status,
      ).toBe(404);
      expect(
        (await call(routes.request, system.session, "preprod")).status,
      ).toBe(200);
    }, 30_000);

    it.each(Object.keys(mixedReads) as (keyof typeof mixedReads)[])(
      "keeps shared %s when the key and header disagree",
      async (name) => {
        const prefix = "soko_preprod_";
        const token = prefix + name;
        await system.shared.apikey.create({
          data: {
            id: token,
            referenceId: ownerId,
            prefix,
            key: createHash("sha256").update(token).digest("base64url"),
            rateLimitEnabled: false,
            createdAt: clock,
            updatedAt: clock,
          },
        });
        await expectSharedMixedRead(name, personalOwner, "preprod");
        await expectSharedMixedRead(name, auth(token), "mainnet");
        for (const [credential, header] of [
          [personalOwner, "preprod"],
          [auth(token), "mainnet"],
        ] as const) {
          const dedicated = await call(routes.list, credential, header);
          expect(dedicated.status).toBe(403);
          expect(JSON.parse(dedicated.body)).toMatchObject({
            kind: "api_key_network_mismatch",
          });
        }
      },
    );

    it("reads mixed Project and Task data from the admitted Network", async () => {
      const personalSession = { cookie: system.session.cookie };
      await system.shared.user.update({
        where: { id: ownerId },
        data: { preprodEnabled: true },
      });
      for (const network of ["mainnet", "preprod"] as const) {
        const preprod = network === "preprod";
        for (const [name, path] of Object.entries(mixedReads)) {
          const answer = await call(
            path,
            name === "tasks" ? system.session : personalSession,
            network,
          );
          expect(answer.status, `${name}: ${answer.body}`).toBe(200);
          const { data } = JSON.parse(answer.body);
          if (name === "projects") {
            expect(data).toEqual([
              expect.objectContaining({
                id: projectId,
                jobCount: preprod ? 0 : 1,
              }),
            ]);
          }
          if (name === "activity") {
            expect(data).toEqual(
              preprod
                ? []
                : [expect.objectContaining({ kind: "job", jobId: projectJob })],
            );
          }
          if (name === "stats") {
            expect(data.projects).toEqual([
              expect.objectContaining({
                projectId,
                jobs: {
                  total: preprod ? 0 : 1,
                  byStatus: preprod ? [] : [{ status: "completed", count: 1 }],
                },
              }),
            ]);
          }
          if (name === "attention") {
            expect(data).toMatchObject({
              jobCount: preprod ? 0 : 1,
              items: [],
            });
          }
          if (name === "tasks") {
            expect(data).toContainEqual(
              expect.objectContaining({
                id: "job-reads-public",
                jobsCount: preprod ? 2 : 3,
              }),
            );
          }
        }
      }
    });

    it("applies parent visibility to Project counts and reads Agent previews on the request Network", async () => {
      const { createNetworkScope } = await import("@/lib/db/network-scope");
      const orgProjectId = "25000000-0000-4000-8000-000000000008";
      await system.shared.project.create({
        data: {
          id: orgProjectId,
          workspaceId: organizationWorkspace,
          name: "Network activity",
        },
      });
      const privateTaskId = "job-reads-private";
      await system.shared.task.update({
        where: { id: privateTaskId },
        data: { projectId: orgProjectId },
      });
      for (const network of ["mainnet", "preprod"] as const) {
        const { networkDb } = createNetworkScope(network);
        for (const [id, taskId] of [
          ["nameless-project-job", null],
          ["private-project-job", privateTaskId],
        ] as const) {
          await networkDb.job.create({
            data: {
              id,
              taskId,
              projectId: orgProjectId,
              agentId,
              agentJobId: id,
              jobType: "FREE",
              workspaceId: organizationWorkspace,
              organizationId,
              ownerId,
              createdAt: clock,
              updatedAt: clock,
              events: {
                create: {
                  status: "RUNNING",
                  createdAt: clock,
                  updatedAt: clock,
                },
              },
            },
          });
        }
      }
      const preprodToken = "soko_preprod_mixed_project_member";
      await system.shared.apikey.create({
        data: {
          id: preprodToken,
          referenceId: memberId,
          prefix: "soko_preprod_",
          key: createHash("sha256").update(preprodToken).digest("base64url"),
          rateLimitEnabled: false,
          createdAt: clock,
          updatedAt: clock,
        },
      });
      for (const network of ["mainnet", "preprod"] as const) {
        const headers =
          network === "mainnet"
            ? member
            : { ...auth(preprodToken), ...organization };
        const list = await call("/v1/projects", headers, network);
        expect(list.status, list.body).toBe(200);
        expect(JSON.parse(list.body).data).toEqual([
          expect.objectContaining({ id: orgProjectId, jobCount: 1 }),
        ]);
        const activity = await call(
          `/v1/projects/activity?projectId=${orgProjectId}`,
          headers,
          network,
        );
        expect(activity.status, activity.body).toBe(200);
        expect(
          JSON.parse(activity.body).data.filter(
            ({ kind }: { kind: string }) => kind === "job",
          ),
        ).toEqual([
          expect.objectContaining({
            jobId: "nameless-project-job",
            title: network,
          }),
        ]);
        const attention = await call(
          `/v1/projects/${orgProjectId}/needs-attention`,
          headers,
          network,
        );
        expect(attention.status, attention.body).toBe(200);
        expect(JSON.parse(attention.body).data).toMatchObject({
          jobCount: 1,
          items: [
            expect.objectContaining({
              id: "nameless-project-job",
              agentName: network,
            }),
          ],
        });
      }
      const sibling = await call(
        "/v1/projects",
        coworker("sibling"),
        "mainnet",
      );
      expect(sibling.status, sibling.body).toBe(200);
      expect(JSON.parse(sibling.body).data).toEqual([
        expect.objectContaining({ id: orgProjectId, jobCount: 1 }),
      ]);
    });

    it("projects PAID twins on the selected Network inside and outside the write transaction", async () => {
      const { createNetworkScope } = await import("@/lib/db/network-scope");
      const {
        taskJobProjectionInclude,
        withTaskResponseJobs,
        readWorkspaceMoveTaskResponse,
      } = await import("@/helpers/task-job-projection");
      const { moveTaskJobs } = await import(
        "@/routes/v1/tasks/[id]/workspace/put"
      );
      const { sharedTable } = await import("@sokosumi/database/sql-tables");
      const { taskInclude } = await import("@/types/task");
      const { flattenJob } = await import("@/types/job");
      const taskId = "job-reads-projection-task";
      const jobId = "job-reads-projection-twin";
      await system.shared.user.create({
        data: {
          id: "",
          name: "Empty ID owner",
          email: "empty@example.test",
          emailVerified: true,
          createdAt: clock,
          updatedAt: clock,
        },
      });
      await system.shared.task.create({
        data: {
          id: taskId,
          name: "Job projection",
          ownerId,
          workspaceId: personalWorkspace,
        },
      });

      const networks = ["mainnet", "preprod"] as const;
      for (const network of networks) {
        const { networkDb } = createNetworkScope(network);
        await networkDb.transaction.create({
          data: {
            id: "job-reads-projection-debit",
            amount: network === "mainnet" ? -25000000000n : -75000000000n,
            userId: ownerId,
          },
        });
        await networkDb.job.create({
          data: {
            id: jobId,
            name: network,
            taskId,
            agentId,
            agentJobId: jobId,
            jobType: "PAID",
            blockchainIdentifier: jobId,
            identifierFromPurchaser: "job-reads-buyer",
            sellerVkey: "job-reads-seller",
            payByTime: clock,
            submitResultTime: clock,
            unlockTime: clock,
            externalDisputeUnlockTime: clock,
            workspaceId: personalWorkspace,
            ownerId: "",
            organizationId,
            creatorCoworkerId: "job-reads-assigned",
            transactionId: "job-reads-projection-debit",
            createdAt: clock,
            updatedAt: clock,
            purchase: {
              create: {
                externalId: "job-reads-projection-purchase",
                onChainStatus: "FUNDS_LOCKED",
              },
            },
            events: {
              create: {
                status: "AWAITING_INPUT",
                createdAt: clock,
                updatedAt: clock,
                ...(network === "mainnet" && {
                  input: { create: { input: "answered" } },
                }),
              },
            },
          },
        });
      }

      for (const network of networks) {
        const scope = createNetworkScope(network);
        const readTask = (db: typeof scope.sharedDb) =>
          db.task.findUniqueOrThrow({
            where: { id: taskId },
            // The separate TaskEvent debit relation moves with ticket 29.
            include: {
              ...taskJobProjectionInclude(taskInclude, scope),
              events: false,
            },
          });
        const expected = {
          id: jobId,
          name: network,
          owner: { id: "", name: "Empty ID owner" },
          credits: network === "mainnet" ? 2.5 : 7.5,
          status: network === "mainnet" ? "processing" : "input_required",
        };
        const task = await readTask(scope.sharedDb);
        const detail = await withTaskResponseJobs(task, scope);
        expect(detail.jobs.map(flattenJob)).toMatchObject([expected]);
        const locker = new Client({ connectionString: system.database.url });
        await locker.connect();
        try {
          // Hold the first shared relation read while the other reads can queue.
          await locker.query("BEGIN");
          await locker.query(
            `LOCK TABLE ${sharedTable("workspace").sql} IN ACCESS EXCLUSIVE MODE`,
          );
          let startedOrganizationRead = () => false;
          const observed = observing(
            () =>
              scope.sharedTransactionOnce((tx) => {
                const findOrganizations = tx.organization.findMany;
                vi.spyOn(tx.organization, "findMany").mockImplementation(
                  (args) => {
                    const query = findOrganizations(args);
                    const then = vi.spyOn(query, "then");
                    startedOrganizationRead = () => then.mock.calls.length > 0;
                    return query;
                  },
                );
                return withTaskResponseJobs(task, scope, tx);
              }),
            { trackResponses: true },
          );
          try {
            await vi.waitFor(
              async () => {
                const { rowCount } = await locker.query(
                  "SELECT pid FROM pg_stat_activity WHERE pg_backend_pid() = ANY(pg_blocking_pids(pid))",
                );
                expect(rowCount).toBe(1);
              },
              { timeout: 2_500 },
            );
            expect(startedOrganizationRead()).toBe(false);
          } finally {
            await locker.query("ROLLBACK");
          }
          const { outcome, log } = await observed;
          if ("threw" in outcome)
            throw new Error(JSON.stringify(outcome.threw));
          expect(outcome.jobs.map(flattenJob)).toMatchObject([expected]);
          expect(log.flatMap((entry) => entry.pendingAtSend ?? [])).toEqual([]);
        } finally {
          await locker.end();
        }
      }

      const preprod = createNetworkScope("preprod");
      const staleTask = await system.shared.task.findUniqueOrThrow({
        where: { id: taskId },
      });
      const moved = await preprod.sharedTransactionOnce(async (tx) => {
        await tx.task.update({
          where: { id: taskId },
          data: { workspaceId: organizationWorkspace, organizationId },
        });
        await moveTaskJobs(tx, taskId, organizationWorkspace);
        return readWorkspaceMoveTaskResponse(preprod, tx, taskId, () =>
          tx.task.findUniqueOrThrow({ where: { id: taskId } }),
        );
      });
      expect(moved.jobs.map(flattenJob)).toMatchObject([
        {
          id: jobId,
          name: "preprod",
          credits: 7.5,
          workspace: { id: organizationWorkspace },
        },
      ]);
      for (const network of networks) {
        const scope = createNetworkScope(network);
        // The writer commits between the shared Task read and the Job projection.
        expect((await withTaskResponseJobs(staleTask, scope)).jobs).toEqual([]);
        const fresh = await withTaskResponseJobs(moved, scope);
        expect(fresh.jobs).toMatchObject([
          {
            id: jobId,
            name: network,
            workspaceId: organizationWorkspace,
            projectId: null,
          },
        ]);
      }

      const mainnet = createNetworkScope("mainnet");
      await mainnet.networkDb.job.delete({ where: { id: jobId } });
      expect((await withTaskResponseJobs(moved, mainnet)).jobs).toEqual([]);
      expect((await withTaskResponseJobs(moved, preprod)).jobs).toMatchObject([
        { id: jobId },
      ]);
      await system.shared.task.delete({ where: { id: taskId } });
      // The Job remains, and deleting its parent clears the foreign key.
      expect(
        await preprod.networkDb.job.findUnique({ where: { id: jobId } }),
      ).toMatchObject({ taskId: null });
      expect((await withTaskResponseJobs(moved, preprod)).jobs).toEqual([]);
    });

    it("refuses a workspace without Preprod access before any Network read", async () => {
      await system.shared.organization.update({
        where: { id: organizationId },
        data: { preprodEnabled: false },
      });
      try {
        await expectRefusals(system.session, "preprod_access_required");
      } finally {
        await system.shared.organization.update({
          where: { id: organizationId },
          data: { preprodEnabled: true },
        });
      }
    }, 30_000);
  });
});
