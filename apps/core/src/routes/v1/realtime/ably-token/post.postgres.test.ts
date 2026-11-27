/**
 * The Ably token and the Job status publish on a real PostgreSQL, with real
 * credentials: what a Mainnet user is granted (today's capability and the one
 * Mainnet Job entry, whatever the request says about the Network), and which
 * Preprod Job channels a caller with access gets and is published to.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/routes/v1/realtime/ably-token/post.postgres.test.ts
 */
// First: schemas built before this module loads have no `.openapi`, and the
// `/v1` router needs it on the ones `@sokosumi/utils` exports.
import "@hono/zod-openapi";

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { expectCoreLog } from "@/test/core-log";
import { onSplitLayout } from "@/test/split-layout";

const pools = vi.hoisted(() => [] as Pool[]);
/** Statements Core's pool sent: the database client decides what a read is. */
const sent = vi.hoisted(() => ({ statements: 0 }));
/** Work a request hands to `waitUntil`, awaited as part of that request. */
const background = vi.hoisted(() => [] as Promise<unknown>[]);
/** The channel and event name of every Ably publish. */
const published = vi.hoisted(() => [] as [channel: string, event: string][]);
vi.mock("@vercel/functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/functions")>();
  return {
    ...actual,
    waitUntil: vi.fn((work: Promise<unknown>) => {
      background.push(work);
    }),
    attachDatabasePool: (pool: Pool) => {
      pools.push(pool);
      pool.on("connect", (client: PoolClient) => {
        const query = client.query.bind(client) as (...a: unknown[]) => unknown;
        (client as { query: unknown }).query = (...args: unknown[]) => {
          sent.statements += 1;
          return query(...args);
        };
      });
      actual.attachDatabasePool(pool);
    },
  };
});
// setup.ts mocks this module for every file; its factory result survives
// vi.resetModules(), so a reload with another environment would keep the first.
vi.unmock("@/lib/db/prisma");
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
// Production names, as a Mainnet user's browser builds them. Not through
// `VERCEL_ENV`: Core's startup check asks production for its real secrets.
vi.mock("@/lib/ably/realtime-channel-environment", () => ({
  getRealtimeChannelEnvironment: () => ({
    network: "Mainnet",
    vercelEnv: "production",
  }),
}));
// The token is signed by the real SDK, which needs no network; only the
// publishing client is replaced.
vi.mock("@/lib/ably/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ably/client")>();
  return {
    ...actual,
    getRestClient: () => ({
      channels: {
        get: (channel: string) => ({
          publish: async (event: string) => {
            published.push([channel, event]);
          },
        }),
      },
    }),
  };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const ORIGIN = "https://example.com";
/**
 * A suite's setup reloads Core's modules: the first fresh import of the whole
 * app took 3.9 s alone on a 12-core machine and 14 s with the suite run on 24
 * workers, past Vitest's 10 s hook limit, as on CI's runner.
 */
const SETUP_TIMEOUT = 60_000;
const HEADER = "X-Sokosumi-Network";
/**
 * Statements of one token request with a session cookie, measured on
 * `origin/main` at 75bd53bb5 before this change, with this file's fixture.
 */
const SESSION_TOKEN_STATEMENTS = 5;

/** Core's modules as a fresh start in this environment loads them. */
async function load(env: Record<string, string>) {
  delete (globalThis as { coreDatabase?: unknown }).coreDatabase;
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("ABLY_SUBSCRIBE_ONLY_KEY", "fake.key:ZmFrZQ==");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const fixture = await import("@/test-fixtures/core-session");
  const { default: prisma } = await import("@/lib/db/prisma");
  // The product's own creation paths, so a fixture workspace has its Files
  // vocabulary (`workspace-creation-chokepoint.test.ts`).
  const { createPersonalWorkspace } = await import(
    "@/helpers/personal-workspace"
  );
  const { workspaceRepository } = await import(
    "@sokosumi/database/repositories"
  );
  const { publishJobStatusData } = await import("@/lib/ably/publish");
  return {
    fixture,
    prisma,
    createPersonalWorkspace,
    workspaceRepository,
    publishJobStatusData,
    app: fixture.createCoreApp(),
  };
}

type Loaded = Awaited<ReturnType<typeof load>>;

interface Person {
  id: string;
  cookie: string;
  workspaceId: string;
}

interface Organization {
  id: string;
  workspaceId: string;
}

/** The fixture's rows and their removal, for one loaded Core. */
function fixtureOf(loaded: () => Loaded) {
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  const oauthClientIds: string[] = [];

  return {
    async person(name: string, role?: string): Promise<Person> {
      const { fixture, createPersonalWorkspace, app } = loaded();
      const user = await fixture.createPasswordUser(name, role);
      userIds.push(user.id);
      const workspace = await createPersonalWorkspace(user.id);
      return {
        id: user.id,
        cookie: await fixture.signIn(app, user.email),
        workspaceId: workspace.id,
      };
    },
    async organization(
      memberIds: string[],
      preprodEnabled: boolean,
    ): Promise<Organization> {
      const { prisma, workspaceRepository } = loaded();
      const { id } = await prisma.organization.create({
        data: {
          name: "Ably token fixture",
          slug: `ably-token-${randomUUID()}`,
          preprodEnabled,
          members: {
            create: memberIds.map((userId) => ({ userId, role: "member" })),
          },
        },
        select: { id: true },
      });
      organizationIds.push(id);
      const workspace = await workspaceRepository.upsertOrganizationWorkspace({
        organizationId: id,
        tx: prisma,
      });
      return { id, workspaceId: workspace.id };
    },
    async apiKey(userId: string) {
      return {
        authorization: `Bearer ${await loaded().fixture.createApiKey(userId)}`,
      };
    },
    async oauthToken(userId: string) {
      const { token, clientId } =
        await loaded().fixture.createOAuthToken(userId);
      oauthClientIds.push(clientId);
      return { authorization: `Bearer ${token}` };
    },
    async remove() {
      const { prisma } = loaded();
      // Rows no foreign key ties to the fixture's people.
      await prisma.apikey.deleteMany({
        where: { referenceId: { in: userIds } },
      });
      await prisma.oauthClient.deleteMany({
        where: { clientId: { in: oauthClientIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      // The free plan `createPersonalWorkspace` grants is not tied to the user.
      await prisma.subscription.deleteMany({
        where: { referenceId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    },
  };
}

/** One token request: its status, capability and statement count. */
async function token(loaded: Loaded, headers: Record<string, string>) {
  const before = sent.statements;
  const response = await loaded.app.request(
    `${ORIGIN}/v1/realtime/ably-token`,
    { method: "POST", headers: { origin: ORIGIN, ...headers } },
  );
  const body = (await response.json()) as { data?: { capability: string } };
  while (background.length > 0) {
    await Promise.allSettled(background.splice(0));
  }
  return {
    status: response.status,
    capability: body.data
      ? (JSON.parse(body.data.capability) as Record<string, string[]>)
      : undefined,
    statements: sent.statements - before,
  };
}

/**
 * What a person in these Organizations was granted before Job channels named
 * a Network, and the one entry Mainnet's Job channels add. Ably's SDK sorts
 * each entry's operations.
 */
function mainnetCapability(person: Person, organizations: Organization[]) {
  return {
    [`agent_jobs:*:user_${person.id}`]: ["subscribe"],
    [`agent_jobs:mainnet:*:user_${person.id}`]: ["subscribe"],
    [`tasks:all:user_${person.id}`]: ["subscribe"],
    [`notifications:all:user_${person.id}`]: [
      "presence",
      "push-subscribe",
      "subscribe",
    ],
    [`chat_control:user_${person.id}`]: ["subscribe"],
    [`calendar_control:user_${person.id}`]: ["subscribe"],
    ...Object.fromEntries(
      organizations.map(({ id }) => [
        `presence:org_${id}`,
        ["presence", "subscribe"],
      ]),
    ),
    ...Object.fromEntries(
      [person, ...organizations].map(({ workspaceId }) => [
        `calendar:workspace_${workspaceId}:user_${person.id}`,
        ["subscribe"],
      ]),
    ),
  };
}

const preprodChannel = (workspaceId: string, userId: string) =>
  `agent_jobs:preprod:workspace_${workspaceId}:user_${userId}`;

const status = (jobId = "job_1") => ({
  jobId,
  jobStatus: "completed" as const,
  jobStatusSettled: true,
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await Promise.all(pools.map((pool) => pool.end()));
});

describe.skipIf(!enabled)("The Ably token with Preprod off", () => {
  let loaded: Loaded;
  const rows = fixtureOf(() => loaded);
  let person: Person;
  let organizations: Organization[];

  let setup: Promise<void> | undefined;
  beforeAll(() => {
    setup = (async () => {
      loaded = await load({});
      person = await rows.person("Token person in two Organizations");
      // Both access flags set: they must change nothing while Preprod is off.
      await loaded.prisma.user.update({
        where: { id: person.id },
        data: { preprodEnabled: true },
      });
      organizations = [
        await rows.organization([person.id], true),
        await rows.organization([person.id], false),
      ];
    })();
    return setup;
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    // Wait for a setup that timed out, so its rows are removed too.
    await setup?.catch(() => undefined);
    if (loaded) await rows.remove();
  }, SETUP_TIMEOUT);

  it("grants a session today's capability and the one Mainnet Job entry, with no statement more", async () => {
    const answer = await token(loaded, { cookie: person.cookie });

    expect(answer.status).toBe(200);
    expect(answer.statements).toBe(SESSION_TOKEN_STATEMENTS);
    expect(answer.capability).toEqual(mainnetCapability(person, organizations));
  });

  it("answers 200 with the same capability and statements whatever the header names", async () => {
    const none = await token(loaded, { cookie: person.cookie });
    for (const network of ["mainnet", "preprod"]) {
      expect(
        await token(loaded, { cookie: person.cookie, [HEADER]: network }),
      ).toEqual(none);
    }
  });

  it("grants an API key and an OAuth token the same capability", async () => {
    const expected = mainnetCapability(person, organizations);
    for (const headers of [
      await rows.apiKey(person.id),
      await rows.oauthToken(person.id),
    ]) {
      for (const network of [undefined, "preprod"]) {
        const answer = await token(loaded, {
          ...headers,
          ...(network && { [HEADER]: network }),
        });
        expect(answer.status).toBe(200);
        expect(answer.capability).toEqual(expected);
      }
    }
  });

  it("publishes a Mainnet Job status once, on the Network and Workspace name, reading nothing", async () => {
    published.length = 0;
    const before = sent.statements;

    await loaded.publishJobStatusData({
      network: "mainnet",
      workspaceId: person.workspaceId,
      userId: person.id,
      ...status(),
    });

    expect(sent.statements - before).toBe(0);
    expect(published).toEqual([
      [
        `agent_jobs:mainnet:workspace_${person.workspaceId}:user_${person.id}`,
        "job_status_data",
      ],
    ]);
  });

  it("publishes no Preprod Job status, reading nothing", async () => {
    published.length = 0;
    const before = sent.statements;

    await loaded.publishJobStatusData({
      network: "preprod",
      workspaceId: organizations[0]?.workspaceId ?? "",
      userId: person.id,
      ...status(),
    });

    expect(sent.statements - before).toBe(0);
    expect(published).toEqual([]);
  });
});

describe.runIf(enabled && onSplitLayout)(
  "The Ably token with Preprod on, on the split layout",
  () => {
    let loaded: Loaded;
    const rows = fixtureOf(() => loaded);
    let noAccess: Person;
    let noAccessOrganizations: Organization[];
    let optedIn: Person;
    let member: Person;
    let admin: Person;
    let optedInOrganization: Organization;
    let otherOrganization: Organization;

    let setup: Promise<void> | undefined;
    beforeAll(() => {
      setup = (async () => {
        loaded = await load({ NETWORK_PREPROD_ENABLED: "true" });
        noAccess = await rows.person("Token person without access");
        noAccessOrganizations = [
          await rows.organization([noAccess.id], false),
          await rows.organization([noAccess.id], false),
        ];
        optedIn = await rows.person("Token person opted in");
        await loaded.prisma.user.update({
          where: { id: optedIn.id },
          data: { preprodEnabled: true },
        });
        member = await rows.person("Token member, not opted in");
        admin = await rows.person("Token admin", "admin");
        optedInOrganization = await rows.organization(
          [optedIn.id, member.id],
          true,
        );
        otherOrganization = await rows.organization(
          [optedIn.id, member.id, admin.id],
          false,
        );
      })();
      return setup;
    }, SETUP_TIMEOUT);

    afterAll(async () => {
      await setup?.catch(() => undefined);
      if (loaded) await rows.remove();
    }, SETUP_TIMEOUT);

    const both = () => [optedInOrganization, otherOrganization];

    it("grants a person without access the Mainnet capability, whatever the header names", async () => {
      const expected = mainnetCapability(noAccess, noAccessOrganizations);
      for (const network of [undefined, "mainnet", "preprod"]) {
        const answer = await token(loaded, {
          cookie: noAccess.cookie,
          ...(network && { [HEADER]: network }),
        });
        expect(answer.status).toBe(200);
        expect(answer.capability).toEqual(expected);
      }
    });

    it("grants a session the Preprod Job channel of each Workspace with access, and no other", async () => {
      const granted = async (person: Person, workspaceIds: string[]) => {
        const expected = {
          ...mainnetCapability(person, both()),
          ...Object.fromEntries(
            workspaceIds.map((workspaceId) => [
              preprodChannel(workspaceId, person.id),
              ["subscribe"],
            ]),
          ),
        };
        for (const network of [undefined, "mainnet", "preprod"]) {
          const answer = await token(loaded, {
            cookie: person.cookie,
            ...(network && { [HEADER]: network }),
          });
          expect(answer.status).toBe(200);
          expect(answer.capability).toEqual(expected);
        }
      };
      // Their own flag for the personal Workspace, the Organization's for its.
      await granted(optedIn, [
        optedIn.workspaceId,
        optedInOrganization.workspaceId,
      ]);
      await granted(member, [optedInOrganization.workspaceId]);
    });

    it("grants a platform admin the Preprod Job channel of each of their Workspaces", async () => {
      const answer = await token(loaded, { cookie: admin.cookie });

      expect(answer.capability).toEqual({
        ...mainnetCapability(admin, [otherOrganization]),
        [preprodChannel(admin.workspaceId, admin.id)]: ["subscribe"],
        [preprodChannel(otherOrganization.workspaceId, admin.id)]: [
          "subscribe",
        ],
      });
    });

    it("grants an API key and an OAuth token no Preprod Job channel, also with access", async () => {
      const expected = mainnetCapability(optedIn, both());
      for (const headers of [
        await rows.apiKey(optedIn.id),
        await rows.oauthToken(optedIn.id),
      ]) {
        for (const network of [undefined, "preprod"]) {
          const answer = await token(loaded, {
            ...headers,
            ...(network && { [HEADER]: network }),
          });
          expect(answer.status).toBe(200);
          expect(answer.capability).toEqual(expected);
        }
      }
    });

    it("publishes a Mainnet Job status once, reading nothing", async () => {
      published.length = 0;
      const before = sent.statements;

      await loaded.publishJobStatusData({
        network: "mainnet",
        workspaceId: noAccess.workspaceId,
        userId: noAccess.id,
        ...status(),
      });

      expect(sent.statements - before).toBe(0);
      expect(published).toEqual([
        [
          `agent_jobs:mainnet:workspace_${noAccess.workspaceId}:user_${noAccess.id}`,
          "job_status_data",
        ],
      ]);
    });

    it("publishes a Preprod Job status to an Owner with access in the Job's Workspace", async () => {
      published.length = 0;
      const withAccess: [Person, string][] = [
        [optedIn, optedIn.workspaceId],
        [optedIn, optedInOrganization.workspaceId],
        [member, optedInOrganization.workspaceId],
        [admin, otherOrganization.workspaceId],
      ];

      for (const [owner, workspaceId] of withAccess) {
        await loaded.publishJobStatusData({
          network: "preprod",
          workspaceId,
          userId: owner.id,
          ...status(),
        });
      }

      expect(published).toEqual(
        withAccess.map(([owner, workspaceId]) => [
          preprodChannel(workspaceId, owner.id),
          "job_status_data",
        ]),
      );
    });

    it("drops a Preprod Job status of an Owner without access there, with a warning", async () => {
      published.length = 0;
      const withoutAccess: [Person, string][] = [
        [noAccess, noAccess.workspaceId],
        [member, member.workspaceId],
        // Opted in themselves, in an Organization that is not.
        [optedIn, otherOrganization.workspaceId],
        // Opted in themselves, in a Workspace they are no member of.
        [optedIn, noAccessOrganizations[0]?.workspaceId ?? ""],
        // A member no more of the Organization that is opted in.
        [noAccess, optedInOrganization.workspaceId],
      ];
      const warnings = expectCoreLog(
        "warn",
        "Dropped a Preprod job status event",
        withoutAccess.length,
      );

      for (const [owner, workspaceId] of withoutAccess) {
        await loaded.publishJobStatusData({
          network: "preprod",
          workspaceId,
          userId: owner.id,
          ...status(),
        });
      }

      expect(published).toEqual([]);
      expect(warnings).toHaveLength(withoutAccess.length);
    });
  },
);
