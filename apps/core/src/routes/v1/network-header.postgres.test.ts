/**
 * The first rule of `X-Sokosumi-Network` on a real PostgreSQL, on both
 * layouts, with real credentials and Preprod off: a client that sends no
 * header gets what it got before, a Mainnet request reads nothing more, and
 * only Network data is refused to Preprod. Each case runs on a deployment
 * whose `NETWORK` is Mainnet and on one whose `NETWORK` is Preprod (the old
 * Preprod: Preprod off, every schema `public` on today's layout).
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/routes/v1/network-header.postgres.test.ts
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
const sent = vi.hoisted(() => ({ statements: 0, detailReads: [] as number[] }));
// Count statements during the real catalog call. Authentication may also read
// a vendor grant on the first request for a workspace.
vi.mock("@/lib/agent-catalog/detail", async (load) => {
  const actual = await load<typeof import("@/lib/agent-catalog/detail")>();
  return {
    ...actual,
    async getAvailableAgent(
      ...args: Parameters<typeof actual.getAvailableAgent>
    ) {
      const before = sent.statements;
      try {
        return await actual.getAvailableAgent(...args);
      } finally {
        sent.detailReads.push(sent.statements - before);
      }
    },
  };
});
/** Work a request hands to `waitUntil`, awaited as part of that request. */
const background = vi.hoisted(() => [] as Promise<unknown>[]);
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
 * A test that sends many requests: under a second here alone, past Vitest's
 * 5 s default once on a loaded machine, as CI's runner can be.
 */
const MANY_REQUESTS = 30_000;
/** An origin Core's CORS allows (`resolveCorsAllowOrigin`). */
const BROWSER = "https://app.sokosumi.com";

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
  return {
    fixture,
    prisma,
    createNetworkScope,
    createPersonalWorkspace,
    app: fixture.createCoreApp(),
  };
}

type Loaded = Awaited<ReturnType<typeof load>>;

interface Answer {
  status: number;
  body: unknown;
  statements: number;
}

/** One request; `meta` without the time and the request id it carries. */
async function call(
  loaded: Loaded,
  path: string,
  headers: Record<string, string>,
): Promise<Answer> {
  const before = sent.statements;
  const detailCalls = sent.detailReads.length;
  const response = await loaded.app.request(`${ORIGIN}${path}`, {
    headers: { origin: ORIGIN, ...headers },
  });
  if (response.status === 403 && path.startsWith("/v1/agents/")) {
    expect(sent.detailReads.slice(detailCalls)).toEqual([0]);
  }
  const text = await response.text();
  while (background.length > 0) {
    await Promise.allSettled(background.splice(0));
  }
  const statements = sent.statements - before;
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  const meta = body?.meta as Record<string, unknown> | undefined;
  if (meta) {
    delete meta.timestamp;
    delete meta.requestId;
  }
  return { status: response.status, body, statements };
}

/**
 * The old Preprod's catalog for the fixture of "answers the old Preprod's paid
 * catalog as before this ticket": recorded by that test on 2026-11-27 with
 * `apps/core/src`'s catalog, middleware, router and helper files taken from
 * `origin/main` at e6a0d5e60, before this ticket. Rows, order, pagination
 * and statement counts; the free Agent's id, name and times are normalized.
 */
const OLD_PREPROD_CATALOG = {
  "/v1/agents?limit=2": {
    status: 200,
    body: {
      data: [
        {
          id: "n20-old-preprod-v2",
          createdAt: "2026-11-25T12:00:00.000Z",
          updatedAt: "2026-11-25T12:00:00.000Z",
          name: "Paid Cardano V2",
          image: null,
          icon: null,
          credits: 2,
          summary: null,
          description: "Paid Cardano fixture",
          metrics: {
            executions: {
              count: 9,
              averageTime: null,
            },
            ratings: {
              total: 1,
              average: 4,
            },
          },
          author: {
            name: null,
            image: null,
            organization: null,
            email: null,
            other: null,
          },
          legal: {
            privacyPolicy: null,
            terms: null,
            dpa: null,
            other: null,
          },
          categories: [],
          kind: "cardano",
        },
        {
          id: "n20-old-preprod-x402",
          specification: "bazaar",
          name: "Paid x402",
          description: "Paid x402 fixture",
          image: null,
          x402ResourcesUrl: "https://agent.example.com/.well-known/x402",
          openApiSpecUrl: null,
          kind: "x402",
          pricingType: "fixed",
          isPayable: true,
          paymentSources: [
            {
              caip2Network: "eip155:84532",
              asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
              decimals: 6,
              payTo: "0x1111111111111111111111111111111111111111",
              amount: "2000000",
              credits: 2,
            },
          ],
        },
      ],
      meta: {
        pagination: {
          cursor: null,
          limit: 2,
          total: 3,
          nextCursor: "n20-old-preprod-x402",
        },
      },
    },
    statements: 15,
  },
  "/v1/agents?limit=2&cursor=n20-old-preprod-x402": {
    status: 200,
    body: {
      data: [
        {
          id: "free-agent",
          createdAt: "free",
          updatedAt: "free",
          name: "free agent",
          image: null,
          icon: null,
          credits: 0,
          summary: null,
          description: "Fixture",
          metrics: {
            executions: {
              count: 0,
              averageTime: null,
            },
            ratings: {
              total: 0,
              average: null,
            },
          },
          author: {
            name: null,
            image: null,
            organization: null,
            email: null,
            other: null,
          },
          legal: {
            privacyPolicy: null,
            terms: null,
            dpa: null,
            other: null,
          },
          categories: [],
          kind: "cardano",
        },
      ],
      meta: {
        pagination: {
          cursor: "n20-old-preprod-x402",
          limit: 2,
          total: 3,
          nextCursor: null,
        },
      },
    },
    statements: 15,
  },
  "/v1/agents?kind=cardano": {
    status: 200,
    body: {
      data: [
        {
          id: "n20-old-preprod-v2",
          createdAt: "2026-11-25T12:00:00.000Z",
          updatedAt: "2026-11-25T12:00:00.000Z",
          name: "Paid Cardano V2",
          image: null,
          icon: null,
          credits: 2,
          summary: null,
          description: "Paid Cardano fixture",
          metrics: {
            executions: {
              count: 9,
              averageTime: null,
            },
            ratings: {
              total: 1,
              average: 4,
            },
          },
          author: {
            name: null,
            image: null,
            organization: null,
            email: null,
            other: null,
          },
          legal: {
            privacyPolicy: null,
            terms: null,
            dpa: null,
            other: null,
          },
          categories: [],
          kind: "cardano",
        },
        {
          id: "free-agent",
          createdAt: "free",
          updatedAt: "free",
          name: "free agent",
          image: null,
          icon: null,
          credits: 0,
          summary: null,
          description: "Fixture",
          metrics: {
            executions: {
              count: 0,
              averageTime: null,
            },
            ratings: {
              total: 0,
              average: null,
            },
          },
          author: {
            name: null,
            image: null,
            organization: null,
            email: null,
            other: null,
          },
          legal: {
            privacyPolicy: null,
            terms: null,
            dpa: null,
            other: null,
          },
          categories: [],
          kind: "cardano",
        },
      ],
      meta: {
        pagination: {
          cursor: null,
          limit: 20,
          total: 2,
          nextCursor: null,
        },
      },
    },
    statements: 13,
  },
  "/v1/agents?kind=x402&limit=2": {
    status: 200,
    body: {
      data: [
        {
          id: "n20-old-preprod-x402",
          specification: "bazaar",
          name: "Paid x402",
          description: "Paid x402 fixture",
          image: null,
          x402ResourcesUrl: "https://agent.example.com/.well-known/x402",
          openApiSpecUrl: null,
          kind: "x402",
          pricingType: "fixed",
          isPayable: true,
          paymentSources: [
            {
              caip2Network: "eip155:84532",
              asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
              decimals: 6,
              payTo: "0x1111111111111111111111111111111111111111",
              amount: "2000000",
              credits: 2,
            },
          ],
        },
      ],
      meta: {
        pagination: {
          cursor: null,
          limit: 2,
          total: 1,
          nextCursor: null,
        },
      },
    },
    statements: 14,
  },
};

/**
 * `/v1/users/me` for each of the admin's keys and for the token, as the first
 * suite counts it (two warm-up calls first): 6 statements, with no header and
 * with `mainnet`, on both layouts and both deployments, recorded on
 * origin/main at d8da3ca70, before ticket 21.
 */
const BEARER_READS = 6;

/**
 * The fixed list's statuses for an admin's key where they are not 200,
 * recorded with `BEARER_READS`: Better Auth's Organization list wants a
 * session.
 */
const BEARER_STATUS: Record<string, number> = {
  "/auth/organization/list": 401,
};

/**
 * The fixed list's statements for each of the admin's keys and the token,
 * recorded with the fix round of ticket 21 on origin/main's middleware
 * (d8da3ca70) and on the change: equal on both layouts and deployments.
 */
const BEARER_PATH_READS: Record<string, number> = {
  "/v1/users/me": 6,
  "/v1/users/{id}/workspaces": 11,
  "/v1/users/{id}/organizations": 7,
  "/v1/tasks": 28,
  "/v1/chats/rooms": 15,
  "/v1/notifications": 10,
  "/auth/get-session": 0,
  "/auth/organization/list": 0,
  "/v1/agents": 15,
  "/v1/credit-costs": 5,
  "/v1/agents/{agentId}": 19,
  "/v1/jobs": 19,
};

/** Statements for an old or `soko_mainnet_` key with Preprod on, after two warm-up calls. */
const PREPROD_ON_KEY_READS = { me: 6, catalog: 15 };

/** The catalog for a bearer `soko_preprod_` text that is no key, Preprod on. */
const UNKNOWN_PREPROD_KEY_READS = 17;

afterAll(async () => {
  vi.unstubAllEnvs();
  await Promise.all(pools.map((pool) => pool.end()));
});

describe.skipIf(!enabled).each(["Mainnet", "Preprod"])(
  "X-Sokosumi-Network on a deployment with NETWORK=%s, Preprod off",
  (deploymentNetwork) => {
    let loaded: Loaded;
    const userIds: string[] = [];
    const organizationIds: string[] = [];
    let catalog: { agentId: string; remove: () => Promise<unknown> };
    let agentName: string;
    let admin: { id: string; cookie: string };
    let optedIn: { id: string; cookie: string };
    let plain: { id: string; cookie: string };
    const oauthClientIds: string[] = [];
    /** The admin's keys and token, each as the headers that send it. */
    let bearers: [string, Record<string, string>][];

    async function person(name: string, role?: string) {
      const user = await loaded.fixture.createPasswordUser(name, role);
      userIds.push(user.id);
      // A personal workspace, so a new session opens it and needs no seat.
      await loaded.createPersonalWorkspace(user.id);
      return {
        id: user.id,
        cookie: await loaded.fixture.signIn(loaded.app, user.email),
      };
    }

    async function organization(memberId: string, preprodEnabled: boolean) {
      const created = await loaded.prisma.organization.create({
        data: {
          name: "Network header fixture",
          slug: `network-header-${randomUUID()}`,
          preprodEnabled,
          members: { create: { userId: memberId, role: "owner" } },
        },
      });
      organizationIds.push(created.id);
      return created;
    }

    let setup: Promise<void> | undefined;
    beforeAll(() => {
      setup = (async () => {
        loaded = await load({ NETWORK: deploymentNetwork });
        admin = await person("Network header admin", "admin");
        optedIn = await person("Network header opted in");
        plain = await person("Network header plain");
        await loaded.prisma.user.update({
          where: { id: optedIn.id },
          data: { preprodEnabled: true },
        });
        await organization(admin.id, false);
        await organization(optedIn.id, true);
        agentName = `Network header agent ${randomUUID()}`;
        const { seedCatalogAgent } = await import(
          "@/test-fixtures/network-catalog"
        );
        catalog = await seedCatalogAgent(loaded.createNetworkScope("mainnet"), {
          name: agentName,
        });
        // Rows as each kind of key has its prefix: older than ticket 11, minted
        // by it, and one made with `soko_preprod_` before ticket 11 refused a
        // caller's prefix. While Preprod is off the prefix is not read.
        bearers = [];
        for (const [name, prefix] of [
          ["an old key", null],
          ["a soko_mainnet_ key", "soko_mainnet_"],
          ["a key stored as soko_preprod_", "soko_preprod_"],
        ] as const) {
          const key = await loaded.fixture.createApiKey(admin.id, prefix);
          bearers.push([name, { authorization: `Bearer ${key}` }]);
        }
        const oauth = await loaded.fixture.createOAuthToken(admin.id);
        oauthClientIds.push(oauth.clientId);
        bearers.push([
          "an OAuth token",
          { authorization: `Bearer ${oauth.token}` },
        ]);
      })();
      return setup;
    }, SETUP_TIMEOUT);

    afterAll(async () => {
      // A setup that timed out keeps running: wait for it, then remove what
      // it made, whether it finished or not.
      await setup?.catch(() => undefined);
      if (!loaded) return;
      await catalog?.remove();
      // Rows no foreign key ties to the fixture's people.
      await loaded.prisma.apikey.deleteMany({
        where: { referenceId: { in: userIds } },
      });
      await loaded.prisma.oauthClient.deleteMany({
        where: { clientId: { in: oauthClientIds } },
      });
      await loaded.prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      // The free plan `createPersonalWorkspace` grants is not tied to the user.
      await loaded.prisma.subscription.deleteMany({
        where: { referenceId: { in: userIds } },
      });
      await loaded.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }, SETUP_TIMEOUT);

    /**
     * The first reads of a path can write once (an Organization's missing
     * workspace row; the Task list's second read), so counts start after two.
     */
    async function warm(path: string, cookie: string | Record<string, string>) {
      const headers = typeof cookie === "string" ? { cookie } : cookie;
      await call(loaded, path, headers);
      await call(loaded, path, headers);
    }

    /** Routes that serve shared data, each read by a session. */
    function sharedPaths(userId: string) {
      return [
        "/v1/users/me",
        `/v1/users/${userId}/workspaces`,
        `/v1/users/${userId}/organizations`,
        // Reads Job relations on the default client: today's layout only,
        // until its ticket moves it.
        ...(onSplitLayout ? [] : ["/v1/tasks"]),
        "/v1/chats/rooms",
        "/v1/notifications",
        "/auth/get-session",
        "/auth/organization/list",
      ];
    }

    /** The fixed list: shared routes, and the Network routes on the scope. */
    function fixedPaths(userId: string) {
      return [
        ...sharedPaths(userId),
        "/v1/agents",
        "/v1/credit-costs",
        `/v1/agents/${catalog.agentId}`,
        // Jobs are still on the default client, so their tables are not there
        // on the split layout until the Jobs ticket moves them.
        ...(onSplitLayout ? [] : ["/v1/jobs"]),
      ];
    }

    it("reads for a Mainnet request what it read before this ticket", {
      timeout: MANY_REQUESTS,
    }, async () => {
      // `/v1/users/me` for a session in its personal workspace: 4 statements,
      // counted on both layouts with ticket 58's literal Mainnet scope in the
      // middleware. An access-flag read on a Mainnet request adds one.
      for (const who of [plain, optedIn, admin]) {
        await warm("/v1/users/me", who.cookie);
        for (const headers of [{}, { [HEADER]: "mainnet" }] as Record<
          string,
          string
        >[]) {
          const answer = await call(loaded, "/v1/users/me", {
            cookie: who.cookie,
            ...headers,
          });
          expect(answer.statements).toBe(4);
        }
      }
      // The admin's keys and token, counted the same way on origin/main at
      // d8da3ca70, before ticket 21: the key's Network costs no read.
      for (const [name, credential] of bearers) {
        await warm("/v1/users/me", credential);
        for (const headers of [{}, { [HEADER]: "mainnet" }] as Record<
          string,
          string
        >[]) {
          const answer = await call(loaded, "/v1/users/me", {
            ...credential,
            ...headers,
          });
          expect([name, answer.statements]).toEqual([name, BEARER_READS]);
        }
      }
    });

    it("answers without the header as with mainnet, with the same reads", async () => {
      for (const path of fixedPaths(admin.id)) {
        await warm(path, admin.cookie);
        const none = await call(loaded, path, { cookie: admin.cookie });
        const mainnet = await call(loaded, path, {
          cookie: admin.cookie,
          [HEADER]: "mainnet",
        });
        expect([path, none.status]).toEqual([path, 200]);
        expect([path, mainnet]).toEqual([path, none]);
      }
    });

    it("answers a key or token without the header as with mainnet, and every key as an old one", {
      timeout: MANY_REQUESTS,
    }, async () => {
      for (const path of fixedPaths(admin.id)) {
        let oldKey: Answer | undefined;
        for (const [name, credential] of bearers) {
          await warm(path, credential);
          const none = await call(loaded, path, credential);
          const mainnet = await call(loaded, path, {
            ...credential,
            [HEADER]: "mainnet",
          });
          expect([name, path, mainnet]).toEqual([name, path, none]);
          // The token too: it answers as the key of the same person.
          oldKey ??= none;
          expect([name, path, none]).toEqual([name, path, oldKey]);
        }
        const pinned = path
          .replace(admin.id, "{id}")
          .replace(catalog.agentId, "{agentId}");
        expect([path, oldKey?.status, oldKey?.statements]).toEqual([
          path,
          BEARER_STATUS[path] ?? 200,
          BEARER_PATH_READS[pinned],
        ]);
      }
    });

    it("lists the fixture's Agent to an anonymous caller, with or without mainnet", async () => {
      const none = await call(loaded, "/v1/agents", {});
      const mainnet = await call(loaded, "/v1/agents", { [HEADER]: "mainnet" });
      expect(none.status).toBe(200);
      expect(JSON.stringify(none.body)).toContain(agentName);
      expect(mainnet).toEqual(none);
    });

    it("serves shared data to preprod as without the header, reading nothing more", {
      timeout: MANY_REQUESTS,
    }, async () => {
      for (const who of [plain, optedIn, admin]) {
        for (const path of sharedPaths(who.id)) {
          await warm(path, who.cookie);
          const none = await call(loaded, path, { cookie: who.cookie });
          const preprod = await call(loaded, path, {
            cookie: who.cookie,
            [HEADER]: "preprod",
          });
          expect([path, none.status]).toEqual([path, 200]);
          expect([path, preprod]).toEqual([path, none]);
        }
      }
      for (const [name, credential] of bearers) {
        for (const path of sharedPaths(admin.id)) {
          await warm(path, credential);
          const none = await call(loaded, path, credential);
          const preprod = await call(loaded, path, {
            ...credential,
            [HEADER]: "preprod",
          });
          expect([name, path, preprod]).toEqual([name, path, none]);
        }
      }
    });

    it("refuses Network data to preprod with preprod_off, before any read", {
      timeout: MANY_REQUESTS,
    }, async () => {
      const anonymous = await call(loaded, "/v1/agents", {
        [HEADER]: "preprod",
      });
      expect(anonymous).toMatchObject({
        status: 403,
        body: { kind: "preprod_off" },
        statements: 0,
      });
      // The admin passes the credit costs' own guard; the opted-in person
      // reads the catalog.
      for (const [who, path] of [
        [admin, "/v1/agents"],
        [admin, "/v1/credit-costs"],
        [admin, `/v1/agents/${catalog.agentId}`],
        [optedIn, "/v1/agents"],
      ] as const) {
        {
          const answer = await call(loaded, path, {
            cookie: who.cookie,
            [HEADER]: "preprod",
          });
          expect([path, answer.status, answer.body]).toEqual([
            path,
            403,
            expect.objectContaining({ kind: "preprod_off" }),
          ]);
        }
      }
      for (const [name, credential] of bearers) {
        for (const path of [
          "/v1/agents",
          "/v1/credit-costs",
          `/v1/agents/${catalog.agentId}`,
        ]) {
          const answer = await call(loaded, path, {
            ...credential,
            [HEADER]: "preprod",
          });
          expect([name, path, answer.status, answer.body]).toEqual([
            name,
            path,
            403,
            expect.objectContaining({ kind: "preprod_off" }),
          ]);
        }
      }
    });

    it("answers canUsePreprod false for an admin and an opted-in person", async () => {
      for (const who of [admin, optedIn]) {
        const { body } = await call(loaded, `/v1/users/${who.id}/workspaces`, {
          cookie: who.cookie,
        });
        const { workspaces } = (body as { data: { workspaces: unknown[] } })
          .data;
        // The personal workspace and the Organization's.
        expect(workspaces.length).toBe(2);
        expect(workspaces).toEqual(
          workspaces.map(() =>
            expect.objectContaining({ canUsePreprod: false }),
          ),
        );
      }
    });

    it("answers 400 network_unknown to a value that names no Network, readable by a browser", async () => {
      const paths = [
        ["/v1/users/me", { cookie: admin.cookie }],
        ["/v1/agents", {}],
        ["/v1/credit-costs", { cookie: admin.cookie }],
        ["/auth/get-session", { cookie: admin.cookie }],
      ] as const;
      for (const [path, credential] of paths) {
        for (const value of ["Mainnet", "testnet", ""]) {
          const response = await loaded.app.request(`${ORIGIN}${path}`, {
            headers: { origin: BROWSER, ...credential, [HEADER]: value },
          });
          expect([path, value, response.status]).toEqual([path, value, 400]);
          expect(response.headers.get("access-control-allow-origin")).toBe(
            BROWSER,
          );
          expect(await response.json()).toMatchObject({
            kind: "network_unknown",
          });
        }
      }
    });

    it("lists the header in a preflight, and the same headers as before without it", async () => {
      const preflight = (path: string, requested?: string) =>
        loaded.app.request(`${ORIGIN}${path}`, {
          method: "OPTIONS",
          headers: {
            origin: BROWSER,
            "access-control-request-method": "GET",
            ...(requested && { "access-control-request-headers": requested }),
          },
        });
      const before = {
        "/v1/agents":
          "Content-Type,Authorization,X-Request-Id,X-Organization-Slug,X-Context-User-Id,X-Context-Organization-Id,x-sokosumi-web-build-version",
        "/auth/get-session": "Content-Type,Authorization,x-captcha-response",
        // The newsletter sign-up has a CORS config of its own.
        "/v1/public/newsletters/fixture/subscribe": "Content-Type",
      };
      for (const [path, headers] of Object.entries(before)) {
        const asked = await preflight(path, "x-sokosumi-network");
        expect(asked.headers.get("access-control-allow-headers")).toBe(
          `${headers},${HEADER}`,
        );
        const plainPreflight = await preflight(path);
        expect(plainPreflight.headers.get("access-control-allow-headers")).toBe(
          `${headers},${HEADER}`,
        );
      }
    });
  },
);

interface Person {
  id: string;
  email: string;
  cookie: string;
}

describe.runIf(enabled && onSplitLayout)(
  "X-Sokosumi-Network with Preprod on, on the split layout",
  () => {
    let loaded: Loaded;
    const userIds: string[] = [];
    const organizationIds: string[] = [];
    const removals: (() => Promise<unknown>)[] = [];
    let agentId: string;
    let names: Record<"mainnet" | "preprod", string>;
    let admin: Person;
    let optedIn: Person;
    let notOptedIn: Person;
    let memberOfOptedIn: Person;
    let memberOfNotOptedIn: Person;
    let outsider: Person;
    let optedInOrganization: { id: string; slug: string };
    let notOptedInOrganization: { id: string; slug: string };

    async function person(name: string, role?: string): Promise<Person> {
      const user = await loaded.fixture.createPasswordUser(name, role);
      userIds.push(user.id);
      await loaded.createPersonalWorkspace(user.id);
      return {
        id: user.id,
        email: user.email,
        cookie: await loaded.fixture.signIn(loaded.app, user.email),
      };
    }

    async function organization(memberId: string, preprodEnabled: boolean) {
      const created = await loaded.prisma.organization.create({
        data: {
          name: "Network access fixture",
          slug: `network-access-${randomUUID()}`,
          preprodEnabled,
          members: { create: { userId: memberId, role: "member" } },
        },
        select: { id: true, slug: true },
      });
      organizationIds.push(created.id);
      return created;
    }

    let setup: Promise<void> | undefined;
    beforeAll(() => {
      setup = (async () => {
        loaded = await load({ NETWORK_PREPROD_ENABLED: "true" });
        agentId = randomUUID();
        names = {
          mainnet: `Mainnet agent ${agentId}`,
          preprod: `Preprod agent ${agentId}`,
        };
        const { seedCatalogAgent } = await import(
          "@/test-fixtures/network-catalog"
        );
        for (const network of ["mainnet", "preprod"] as const) {
          const seeded = await seedCatalogAgent(
            loaded.createNetworkScope(network),
            { id: agentId, name: names[network] },
          );
          removals.push(seeded.remove);
        }
        admin = await person("Access admin", "admin");
        optedIn = await person("Access opted in");
        notOptedIn = await person("Access not opted in");
        memberOfOptedIn = await person(
          "Access member of an opted-in Organization",
        );
        memberOfNotOptedIn = await person(
          "Access member of another Organization",
        );
        outsider = await person("Access outsider");
        await loaded.prisma.user.update({
          where: { id: optedIn.id },
          data: { preprodEnabled: true },
        });
        optedInOrganization = await organization(memberOfOptedIn.id, true);
        notOptedInOrganization = await organization(
          memberOfNotOptedIn.id,
          false,
        );
      })();
      return setup;
    }, SETUP_TIMEOUT);

    const oauthClientIds: string[] = [];
    const vendorIds: string[] = [];

    async function oauthToken(userId: string, firstParty = true) {
      const { token, clientId } = await loaded.fixture.createOAuthToken(
        userId,
        firstParty,
      );
      oauthClientIds.push(clientId);
      return token;
    }

    async function coworkerKey() {
      const { token, vendorId } = await loaded.fixture.createCoworkerKey();
      vendorIds.push(vendorId);
      return token;
    }

    afterAll(async () => {
      // As in the first suite: wait for a setup that timed out.
      await setup?.catch(() => undefined);
      if (!loaded) return;
      for (const remove of removals) await remove();
      // Rows no foreign key ties to the fixture's people.
      await loaded.prisma.apikey.deleteMany({
        where: { referenceId: { in: userIds } },
      });
      await loaded.prisma.oauthClient.deleteMany({
        where: { clientId: { in: oauthClientIds } },
      });
      await loaded.prisma.coworker.deleteMany({
        where: { vendorId: { in: vendorIds } },
      });
      await loaded.prisma.vendor.deleteMany({
        where: { id: { in: vendorIds } },
      });
      await loaded.prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      // The free plan `createPersonalWorkspace` grants is not tied to the user.
      await loaded.prisma.subscription.deleteMany({
        where: { referenceId: { in: userIds } },
      });
      await loaded.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }, SETUP_TIMEOUT);

    /** The names of the fixture Agent the catalog lists to this caller. */
    async function listed(headers: Record<string, string>) {
      const answer = await call(loaded, "/v1/agents", headers);
      const items = (answer.body as { data?: { id: string; name: string }[] })
        .data;
      return {
        status: answer.status,
        kind: (answer.body as { kind?: string }).kind,
        names: items?.filter((item) => item.id === agentId).map((i) => i.name),
      };
    }

    async function detail(headers: Record<string, string>) {
      const answer = await call(loaded, `/v1/agents/${agentId}`, headers);
      const body = answer.body as { data?: { name: string }; kind?: string };
      return {
        status: answer.status,
        kind: body.kind,
        names: body.data ? [body.data.name] : undefined,
      };
    }

    const allowed = (network: "mainnet" | "preprod") => ({
      status: 200,
      kind: undefined,
      names: [names[network]],
    });
    const refused = {
      status: 403,
      kind: "preprod_access_required",
      names: undefined,
    };
    const mismatch = {
      status: 403,
      kind: "api_key_network_mismatch",
      names: undefined,
    };
    const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
    const slug = (organization: { slug: string }) => ({
      "X-Organization-Slug": organization.slug,
    });
    /** A key of the person, its row and text with this prefix (null: none). */
    const key = async (who: Person, prefix: string | null) =>
      bearer(await loaded.fixture.createApiKey(who.id, prefix));

    // The old Preprod recording used NETWORK=Preprod, one schema and Preprod off.
    // It captured both paid rails, pagination, response bodies and statement counts.
    // Ticket 22 now serves that catalog through an authenticated, enabled Preprod scope.
    it("serves the recorded paid catalog from the Preprod scope", async () => {
      const ids = { v2: "n20-old-preprod-v2", x402: "n20-old-preprod-x402" };
      const v2Policy = "a".repeat(56);
      const v2Address = "addr_test1_n20";
      const asset = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
      const payTo = "0x1111111111111111111111111111111111111111";
      const now = new Date("2026-11-25T12:00:00.000Z");
      const seed = {
        lastUptimeCheck: now,
        uptimeCount: 1,
        uptimeCheckCount: 1,
        createdAt: now,
        updatedAt: now,
        isShown: true,
        apiBaseUrl: "https://agent.example.com",
      };
      const readiness = [
        {
          key: "preprod:cardano-v2-rail-readiness",
          cursorId: JSON.stringify([
            { policyId: v2Policy, smartContractAddress: v2Address },
          ]),
        },
        {
          key: "preprod:x402-buy-side-readiness",
          cursorId: JSON.stringify([
            {
              caip2Network: "eip155:84532",
              asset,
              decimals: 6,
              evmWalletId: "n20-wallet",
              evmWalletAddress: payTo,
            },
          ]),
        },
      ];
      const units = ["lovelace", `eip155:84532/erc20:${asset}`];
      const { prisma } = loaded;
      // Network rows through the Mainnet scope, shared ones on the default
      // client, so the fixture names the right schema on either layout.
      const scope = loaded.createNetworkScope("preprod");
      const db = scope.networkDb;
      const keys = readiness.map((row) => row.key);
      // What the fixture finds is kept and put back; what it creates, it
      // removes. Every created row is known to cleanup before the next
      // await: ids are made here and recorded before the write, and an
      // Agent (fixed id, so it may exist already) right after its create.
      const kept = await prisma.syncMetadata.findMany({
        where: { key: { in: keys } },
      });
      const created = {
        costIds: [] as string[],
        agentIds: [] as string[],
        pricingIds: [] as string[],
        fixedPricingIds: [] as string[],
        unitValueIds: [] as string[],
      };
      const made = <K extends keyof typeof created>(kind: K) => {
        const id = randomUUID();
        created[kind].push(id);
        return id;
      };
      try {
        for (const row of readiness) {
          await prisma.syncMetadata.upsert({
            where: { key: row.key },
            create: { ...row, lastSyncedAt: now },
            update: { cursorId: row.cursorId, lastSyncedAt: now },
          });
        }
        const existingUnits = (
          await db.creditCost.findMany({ where: { unit: { in: units } } })
        ).map((cost) => cost.unit);
        for (const unit of units.filter((u) => !existingUnits.includes(u))) {
          const id = made("costIds");
          await scope.netTransaction(async (tx) => {
            // shortcut: the unit trigger calls `public.canonical_credit_cost_unit`,
            // which the split layout moved to `shared`; drop this line with ticket 19.
            if (onSplitLayout) {
              await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
            }
            await tx.creditCost.create({
              data: { id, unit, centsPerUnit: 10n ** 10n },
            });
          }, "Fixture conflict");
        }
        const v2 = await db.agent.create({
          data: {
            ...seed,
            id: ids.v2,
            blockchainIdentifier: `${v2Policy}123456`,
            name: "Paid Cardano V2",
            description: "Paid Cardano fixture",
            jobCount: 9,
            paymentType: "WEB3_CARDANO_V2",
            pricing: {
              create: {
                id: made("pricingIds"),
                pricingType: "FIXED",
                fixedPricing: {
                  create: {
                    id: made("fixedPricingIds"),
                    amounts: {
                      create: {
                        id: made("unitValueIds"),
                        unit: "lovelace",
                        amount: 2n,
                      },
                    },
                  },
                },
              },
            },
            paymentSources: {
              create: {
                sourceIndex: 0,
                chain: "Cardano",
                network: "Preprod",
                paymentSourceType: "Web3CardanoV2",
                address: v2Address,
                pricingType: "FIXED",
              },
            },
          },
        });
        created.agentIds.push(v2.id);
        await db.userAgentRating.create({
          data: { userId: optedIn.id, agentId: v2.id, rating: 4 },
        });
        const x402 = await db.agent.create({
          data: {
            ...seed,
            id: ids.x402,
            blockchainIdentifier: "n20-old-preprod-x402-identifier",
            apiBaseUrl: null,
            type: "X402",
            name: "Paid x402",
            description: "Paid x402 fixture",
            jobCount: 8,
            x402ResourcesUrl: "https://agent.example.com/.well-known/x402",
            pricing: {
              create: { id: made("pricingIds"), pricingType: "UNKNOWN" },
            },
            paymentSources: {
              create: {
                sourceIndex: 0,
                chain: "EVM",
                network: "eip155:84532",
                scheme: "exact",
                payTo,
                address: asset,
                pricingType: "FIXED",
                amounts: {
                  create: { unit: asset, amount: 2_000_000n, decimals: 6 },
                },
              },
            },
          },
        });
        created.agentIds.push(x402.id);

        const answers: Record<string, unknown> = {};
        for (const path of [
          "/v1/agents?limit=2",
          `/v1/agents?limit=2&cursor=${ids.x402}`,
          "/v1/agents?kind=cardano",
          "/v1/agents?kind=x402&limit=2",
        ]) {
          await call(loaded, path, {
            cookie: admin.cookie,
            [HEADER]: "preprod",
          });
          const answer = await call(loaded, path, {
            cookie: admin.cookie,
            [HEADER]: "preprod",
          });
          // The free fixture Agent's id, name and times are random.
          const free = JSON.stringify(answer)
            .replaceAll(names.preprod, "free agent")
            .replaceAll(agentId, "free-agent");
          answers[path] = JSON.parse(free, (key, value) =>
            value?.id === "free-agent"
              ? { ...value, createdAt: "free", updatedAt: "free" }
              : value,
          );
        }
        // Authenticating the admin session for Preprod adds two statements to each public read.
        expect(answers).toEqual(
          Object.fromEntries(
            Object.entries(OLD_PREPROD_CATALOG).map(([path, answer]) => [
              path,
              { ...answer, statements: answer.statements + 2 },
            ]),
          ),
        );
      } finally {
        // Ratings, payment sources and their amounts go with the Agent.
        await db.agent.deleteMany({
          where: { id: { in: created.agentIds } },
        });
        await db.agentPricing.deleteMany({
          where: { id: { in: created.pricingIds } },
        });
        await db.unitValue.deleteMany({
          where: { id: { in: created.unitValueIds } },
        });
        await db.agentFixedPricing.deleteMany({
          where: { id: { in: created.fixedPricingIds } },
        });
        await scope.netTransaction(async (tx) => {
          if (onSplitLayout) {
            await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
          }
          await tx.creditCost.deleteMany({
            where: { id: { in: created.costIds } },
          });
        }, "Fixture conflict");
        await prisma.syncMetadata.deleteMany({
          where: {
            key: {
              in: keys.filter((key) => !kept.some((r) => r.key === key)),
            },
          },
        });
        for (const row of kept) {
          await prisma.syncMetadata.update({
            where: { key: row.key },
            data: row,
          });
        }
      }
    });

    it("lists each Network's own row for the same Agent id", async () => {
      expect(await listed({})).toEqual(allowed("mainnet"));
      expect(await listed({ [HEADER]: "mainnet" })).toEqual(allowed("mainnet"));
      expect(
        await listed({ cookie: admin.cookie, [HEADER]: "preprod" }),
      ).toEqual(allowed("preprod"));
    });

    it("opens the Preprod catalog to the callers that have access, and only to them", {
      timeout: MANY_REQUESTS,
    }, async () => {
      const cases: [string, Record<string, string>, unknown][] = [
        ["anonymous", {}, refused],
        ["an admin's session", { cookie: admin.cookie }, allowed("preprod")],
        [
          "an opted-in person, personal",
          { cookie: optedIn.cookie },
          allowed("preprod"),
        ],
        [
          "a person not opted in, personal",
          { cookie: notOptedIn.cookie },
          refused,
        ],
        [
          "a member of an opted-in Organization, in it",
          { cookie: memberOfOptedIn.cookie, ...slug(optedInOrganization) },
          allowed("preprod"),
        ],
        [
          "a member of an opted-in Organization, personal",
          { cookie: memberOfOptedIn.cookie },
          refused,
        ],
        [
          "a member of an Organization not opted in, in it",
          {
            cookie: memberOfNotOptedIn.cookie,
            ...slug(notOptedInOrganization),
          },
          refused,
        ],
        [
          "an impersonated opted-in person",
          {
            cookie: await loaded.fixture.impersonate(
              loaded.app,
              admin.email,
              optedIn.id,
            ),
          },
          allowed("preprod"),
        ],
        [
          "an impersonated person not opted in",
          {
            cookie: await loaded.fixture.impersonate(
              loaded.app,
              admin.email,
              notOptedIn.id,
            ),
          },
          refused,
        ],
        // A key without a prefix, or with Mainnet's, is Mainnet only.
        ["an admin's old key", await key(admin, null), mismatch],
        ["an opted-in person's old key", await key(optedIn, null), mismatch],
        [
          "an opted-in person's soko_mainnet_ key",
          await key(optedIn, "soko_mainnet_"),
          mismatch,
        ],
        [
          "an admin's OAuth token",
          bearer(await oauthToken(admin.id)),
          allowed("preprod"),
        ],
        [
          "an opted-in person's OAuth token",
          bearer(await oauthToken(optedIn.id)),
          allowed("preprod"),
        ],
        [
          "an opted-in person's third-party OAuth token",
          bearer(await oauthToken(optedIn.id, false)),
          allowed("preprod"),
        ],
        [
          "the OAuth token of a person not opted in",
          bearer(await oauthToken(notOptedIn.id)),
          refused,
        ],
        [
          "a member's OAuth token, in the opted-in Organization",
          {
            ...bearer(await oauthToken(memberOfOptedIn.id)),
            ...slug(optedInOrganization),
          },
          allowed("preprod"),
        ],
        [
          "a member's OAuth token, personal, the Organization opted in",
          bearer(await oauthToken(memberOfOptedIn.id)),
          refused,
        ],
        [
          "a member's OAuth token, in an Organization not opted in",
          {
            ...bearer(await oauthToken(memberOfNotOptedIn.id)),
            ...slug(notOptedInOrganization),
          },
          refused,
        ],
        [
          "a Coworker key",
          {
            authorization: `Bearer ${await coworkerKey()}`,
          },
          refused,
        ],
        [
          "an opted-in person's Soko Bot key",
          {
            authorization: `Bearer ${await loaded.fixture.createSokoBotKey(optedIn.id)}`,
          },
          refused,
        ],
      ];
      for (const [caller, headers, expected] of cases) {
        expect([
          caller,
          await listed({ ...headers, [HEADER]: "preprod" }),
        ]).toEqual([caller, expected]);
        // Detail uses the authenticated router. Anonymous callers stop at auth.
        if (caller !== "anonymous") {
          expect([
            caller,
            await detail({ ...headers, [HEADER]: "preprod" }),
          ]).toEqual([caller, expected]);
        }
        // Without the header every one of them reads Mainnet.
        expect([caller, (await listed(headers)).names]).toEqual([
          caller,
          [names.mainnet],
        ]);
      }
    });

    it("lists a Preprod key's own Network, and refuses it where the header names Mainnet", {
      timeout: MANY_REQUESTS,
    }, async () => {
      const cases: [string, Record<string, string>, unknown][] = [
        ["an admin's", await key(admin, "soko_preprod_"), allowed("preprod")],
        [
          "an opted-in person's",
          await key(optedIn, "soko_preprod_"),
          allowed("preprod"),
        ],
        [
          "a member's, in the opted-in Organization",
          {
            ...(await key(memberOfOptedIn, "soko_preprod_")),
            ...slug(optedInOrganization),
          },
          allowed("preprod"),
        ],
        [
          "a member's, personal, the Organization opted in",
          await key(memberOfOptedIn, "soko_preprod_"),
          refused,
        ],
        [
          "the key of a person not opted in",
          await key(notOptedIn, "soko_preprod_"),
          refused,
        ],
      ];
      for (const [caller, headers, expected] of cases) {
        expect([caller, await listed(headers)]).toEqual([caller, expected]);
        expect([caller, await detail(headers)]).toEqual([caller, expected]);
        expect([
          caller,
          await detail({ ...headers, [HEADER]: "mainnet" }),
        ]).toEqual([caller, mismatch]);
        expect([
          caller,
          await listed({ ...headers, [HEADER]: "preprod" }),
        ]).toEqual([caller, expected]);
        expect([
          caller,
          await listed({ ...headers, [HEADER]: "mainnet" }),
        ]).toEqual([caller, mismatch]);
      }
    });

    it("refuses an MCP caller that names Preprod", async () => {
      // The context `verifyMcpAccessToken` gives an opted-in person's MCP
      // token, on a request Core builds itself, as a tool call would (whose
      // own requests never carry the header).
      const { preAuthenticatedRequests, DEFAULT_USER_ROLE } = await import(
        "@/middleware/auth"
      );
      const { OpenAPIHonoWithAuth } = await import("@/lib/hono");
      const { errorHandler } = await import("@/helpers/error-handler");
      const probe = new OpenAPIHonoWithAuth();
      probe.onError(errorHandler);
      probe.get("/", (c) => c.text(c.var.networkScope.network));
      // The catalog, and a route on an authenticated router that names its
      // scope's Network.
      for (const [name, app, path] of [
        ["the catalog", loaded.app, "/v1/agents"],
        ["the authenticated detail", loaded.app, `/v1/agents/${agentId}`],
        ["an authenticated router", probe, "/"],
      ] as const) {
        const request = new Request(`${ORIGIN}${path}`, {
          headers: { origin: ORIGIN, [HEADER]: "preprod" },
        });
        preAuthenticatedRequests.set(request, {
          isAuthenticated: true,
          authContext: {
            actor: "user",
            userId: optedIn.id,
            organizationId: null,
            role: DEFAULT_USER_ROLE,
            authenticationMethod: "oauth",
          },
        });
        const response = await app.request(request);
        expect([name, response.status, (await response.json()).kind]).toEqual([
          name,
          403,
          "preprod_access_required",
        ]);
      }
    });

    it("keeps a verified Preprod key's Network when its Organization refuses it", {
      timeout: MANY_REQUESTS,
    }, async () => {
      // Without and with the person's own opt-in: the refused Workspace
      // decides, not the personal one.
      for (const who of [outsider, optedIn]) {
        const where = {
          userId_organizationId: {
            userId: who.id,
            organizationId: optedInOrganization.id,
          },
        };
        await loaded.prisma.member.create({
          data: { ...where.userId_organizationId, role: "member" },
        });
        const preprodKey = {
          ...(await key(who, "soko_preprod_")),
          ...slug(optedInOrganization),
        };
        const named = [
          { cookie: who.cookie, ...slug(optedInOrganization) },
          {
            ...bearer(await oauthToken(who.id)),
            ...slug(optedInOrganization),
          },
        ].map((headers) => ({ ...headers, [HEADER]: "preprod" }));
        try {
          expect([who.id, await listed(preprodKey)]).toEqual([
            who.id,
            allowed("preprod"),
          ]);
          for (const headers of named) {
            expect([who.id, await listed(headers)]).toEqual([
              who.id,
              allowed("preprod"),
            ]);
          }
          await loaded.prisma.member.delete({ where });
          // The former member: never Mainnet's rows, never Preprod's.
          for (const [headers, expected] of [
            [preprodKey, refused],
            [{ ...preprodKey, [HEADER]: "preprod" }, refused],
            [{ ...preprodKey, [HEADER]: "mainnet" }, mismatch],
            ...named.map((headers) => [headers, refused] as const),
          ] as const) {
            expect([who.id, await listed(headers)]).toEqual([who.id, expected]);
          }
        } finally {
          await loaded.prisma.member.deleteMany({
            where: where.userId_organizationId,
          });
        }
      }
    });

    it("reads a Preprod key in every bearer syntax authentication accepts", async () => {
      const token = (await key(optedIn, "soko_preprod_")).authorization.slice(
        "Bearer ".length,
      );
      for (const authorization of [
        `bearer ${token}`,
        `Bearer  ${token}`,
        `BEARER \t${token}`,
      ]) {
        expect([authorization, await listed({ authorization })]).toEqual([
          authorization,
          allowed("preprod"),
        ]);
        expect([
          authorization,
          await listed({ authorization, [HEADER]: "mainnet" }),
        ]).toEqual([authorization, mismatch]);
      }
    });

    it("reads for a Mainnet key with Preprod on what it read before ticket 21", async () => {
      // Recorded with the fix round on origin/main's middleware (d8da3ca70)
      // and on the change, with Preprod on.
      for (const credential of [
        await key(optedIn, null),
        await key(optedIn, "soko_mainnet_"),
      ]) {
        for (const [path, statements] of [
          ["/v1/users/me", PREPROD_ON_KEY_READS.me],
          ["/v1/agents", PREPROD_ON_KEY_READS.catalog],
        ] as const) {
          await call(loaded, path, credential);
          await call(loaded, path, credential);
          for (const headers of [{}, { [HEADER]: "mainnet" }] as Record<
            string,
            string
          >[]) {
            const answer = await call(loaded, path, {
              ...credential,
              ...headers,
            });
            expect([path, answer.status, answer.statements]).toEqual([
              path,
              200,
              statements,
            ]);
          }
        }
      }
    });

    it("lists Mainnet to an unknown key with the Preprod prefix", async () => {
      const failures = expectCoreLog("error", "Failed to validate API key:", 2);
      const unknown = bearer(`soko_preprod_${"x".repeat(64)}`);
      // The text asks for the key's row, which is not there: anonymous.
      const answer = await call(loaded, "/v1/agents", unknown);
      expect(answer.status).toBe(200);
      expect(await listed(unknown)).toEqual(allowed("mainnet"));
      expect(answer.statements).toBe(UNKNOWN_PREPROD_KEY_READS);
      expect(failures).toHaveLength(2);
    });

    it("refuses a non-member who names an opted-in Organization", async () => {
      const answer = await call(loaded, "/v1/agents", {
        cookie: outsider.cookie,
        "X-Organization-Slug": optedInOrganization.slug,
        [HEADER]: "preprod",
      });
      expect(answer).toMatchObject({
        status: 403,
        body: { kind: "preprod_access_required" },
      });
    });

    it("refuses a member whose membership ends between the two checks", async () => {
      const where = {
        userId_organizationId: {
          userId: memberOfOptedIn.id,
          organizationId: optedInOrganization.id,
        },
      };
      const member = await loaded.prisma.member.findUniqueOrThrow({ where });
      // Another member stays, so only a check of this person's membership
      // refuses.
      const other = await loaded.prisma.member.create({
        data: {
          userId: admin.id,
          organizationId: optedInOrganization.id,
          role: "member",
        },
      });
      const find = loaded.prisma.member.findFirst.bind(loaded.prisma.member);
      // The Organization middleware's membership read, then the removal.
      const spy = vi
        .spyOn(loaded.prisma.member, "findFirst")
        .mockImplementationOnce(((args: Parameters<typeof find>[0]) =>
          find(args).then(async (found) => {
            await loaded.prisma.member.delete({ where });
            return found;
          })) as typeof find);
      try {
        expect(
          await listed({
            cookie: memberOfOptedIn.cookie,
            "X-Organization-Slug": optedInOrganization.slug,
            [HEADER]: "preprod",
          }),
        ).toEqual(refused);
        expect(spy).toHaveBeenCalledTimes(2);
      } finally {
        spy.mockRestore();
        await loaded.prisma.member.delete({ where: { id: other.id } });
        await loaded.prisma.member.upsert({
          where,
          create: member,
          update: {},
        });
      }
    });

    it("gives an authenticated router the scope of the workspace the request is in", async () => {
      // A route that only names its scope's Network, behind the real
      // middleware: the Organization is known before the scope is made.
      const { OpenAPIHonoWithAuth } = await import("@/lib/hono");
      const { errorHandler } = await import("@/helpers/error-handler");
      const probe = new OpenAPIHonoWithAuth();
      probe.onError(errorHandler);
      probe.get("/", (c) => c.text(c.var.networkScope.network));
      const network = async (headers: Record<string, string>) => {
        const response = await probe.request(`${ORIGIN}/`, {
          headers: { origin: ORIGIN, [HEADER]: "preprod", ...headers },
        });
        return [response.status, await response.text()];
      };
      expect(
        await network({
          cookie: memberOfOptedIn.cookie,
          "X-Organization-Slug": optedInOrganization.slug,
        }),
      ).toEqual([200, "preprod"]);
      expect(await network({ cookie: optedIn.cookie })).toEqual([
        200,
        "preprod",
      ]);
      expect(await network({ cookie: memberOfOptedIn.cookie })).toEqual([
        403,
        expect.stringContaining("preprod_access_required"),
      ]);
    });

    it("gives an authenticated router the scope of a key or token", {
      timeout: MANY_REQUESTS,
    }, async () => {
      const { OpenAPIHonoWithAuth } = await import("@/lib/hono");
      const { errorHandler } = await import("@/helpers/error-handler");
      const probe = new OpenAPIHonoWithAuth();
      probe.onError(errorHandler);
      probe.get("/", (c) => c.text(c.var.networkScope.network));
      const network = async (headers: Record<string, string>) => {
        const response = await probe.request(`${ORIGIN}/`, {
          headers: { origin: ORIGIN, ...headers },
        });
        const text = await response.text();
        return [response.status, response.ok ? text : JSON.parse(text).kind];
      };
      const preprodKey = await key(optedIn, "soko_preprod_");
      const oldKey = await key(optedIn, null);
      const token = {
        ...bearer(await oauthToken(memberOfOptedIn.id)),
        ...slug(optedInOrganization),
      };
      const cases: [string, Record<string, string>, unknown[]][] = [
        ["a Preprod key", preprodKey, [200, "preprod"]],
        [
          "a Preprod key, preprod",
          { ...preprodKey, [HEADER]: "preprod" },
          [200, "preprod"],
        ],
        [
          "a Preprod key, mainnet",
          { ...preprodKey, [HEADER]: "mainnet" },
          [403, "api_key_network_mismatch"],
        ],
        [
          "a Preprod key without access",
          await key(notOptedIn, "soko_preprod_"),
          [403, "preprod_access_required"],
        ],
        ["an old key", oldKey, [200, "mainnet"]],
        [
          "an old key, preprod",
          { ...oldKey, [HEADER]: "preprod" },
          [403, "api_key_network_mismatch"],
        ],
        ["a member's token", token, [200, "mainnet"]],
        [
          "a member's token, preprod",
          { ...token, [HEADER]: "preprod" },
          [200, "preprod"],
        ],
      ];
      for (const [caller, headers, expected] of cases) {
        expect([caller, await network(headers)]).toEqual([caller, expected]);
      }
    });

    it("serves shared data to a key the header contradicts as without the header", {
      timeout: MANY_REQUESTS,
    }, async () => {
      for (const [caller, headers, header] of [
        ["an old key", await key(optedIn, null), "preprod"],
        ["a Preprod key", await key(optedIn, "soko_preprod_"), "mainnet"],
      ] as const) {
        for (const path of [
          "/v1/users/me",
          `/v1/users/${optedIn.id}/workspaces`,
        ]) {
          const none = await call(loaded, path, headers);
          const named = await call(loaded, path, {
            ...headers,
            [HEADER]: header,
          });
          expect([caller, path, none.status]).toEqual([caller, path, 200]);
          expect([caller, path, named.status, named.body]).toEqual([
            caller,
            path,
            none.status,
            none.body,
          ]);
        }
      }
    });

    it("gives an authenticated router the Preprod scope of a caller with access", async () => {
      const answer = await call(loaded, "/v1/credit-costs", {
        cookie: admin.cookie,
        [HEADER]: "preprod",
      });
      expect(answer.status).toBe(200);
      const mainnet = await call(loaded, "/v1/credit-costs", {
        cookie: admin.cookie,
      });
      // Each Network has its own fixture credit cost.
      expect(answer.body).not.toEqual(mainnet.body);
    });

    it("runs the admin Agent and rate routes on the Preprod scope of an admin", async () => {
      async function send(
        method: string,
        path: string,
        network: "mainnet" | "preprod",
        body?: unknown,
      ) {
        const response = await loaded.app.request(`${ORIGIN}${path}`, {
          method,
          headers: {
            origin: ORIGIN,
            cookie: admin.cookie,
            [HEADER]: network,
            ...(body !== undefined && { "content-type": "application/json" }),
          },
          ...(body !== undefined && { body: JSON.stringify(body) }),
        });
        const json = (await response.json()) as {
          data?: Record<string, unknown> & {
            registry?: { name: string };
            resolved?: { name: string };
          };
        };
        return { status: response.status, data: json.data };
      }
      const detail = async (network: "mainnet" | "preprod") => {
        const { status, data } = await send(
          "GET",
          `/v1/admin/agents/${agentId}`,
          network,
        );
        return [status, data?.registry?.name, data?.resolved?.name];
      };

      for (const sortBy of ["displayName", "createdAt"]) {
        const list = await send(
          "GET",
          `/v1/admin/agents?q=${agentId}&sortBy=${sortBy}`,
          "preprod",
        );
        const items = list.data as unknown as { registryName: string }[];
        expect([sortBy, items.map((item) => item.registryName)]).toEqual([
          sortBy,
          [names.preprod],
        ]);
      }
      expect(await detail("preprod")).toEqual([
        200,
        names.preprod,
        names.preprod,
      ]);
      const patched = await send(
        "PATCH",
        `/v1/admin/agents/${agentId}/metadata-override`,
        "preprod",
        { name: "Preprod override" },
      );
      expect(patched.data?.resolved?.name).toBe("Preprod override");
      expect(await detail("mainnet")).toEqual([
        200,
        names.mainnet,
        names.mainnet,
      ]);
      await send(
        "DELETE",
        `/v1/admin/agents/${agentId}/metadata-override`,
        "preprod",
      );
      expect(await detail("preprod")).toEqual([
        200,
        names.preprod,
        names.preprod,
      ]);

      const unit = `n6_${agentId}`;
      const created = await send("POST", "/v1/credit-costs", "preprod", {
        unit: ` ${unit.toUpperCase()} `,
        creditsPerUnit: 2,
      });
      const rateId = String(created.data?.id);
      try {
        expect([created.status, created.data?.unit]).toEqual([201, unit]);
        const where = { where: { unit } };
        const preprod = loaded.createNetworkScope("preprod").networkDb;
        const mainnet = loaded.createNetworkScope("mainnet").networkDb;
        expect(await preprod.creditCost.count(where)).toBe(1);
        expect(await mainnet.creditCost.count(where)).toBe(0);
        const path = `/v1/credit-costs/${rateId}`;
        expect((await send("GET", path, "mainnet")).status).toBe(404);
        expect((await send("GET", path, "preprod")).status).toBe(200);
        const updated = await send("PATCH", path, "preprod", {
          creditsPerUnit: 3,
        });
        expect([updated.status, updated.data?.creditsPerUnit]).toEqual([
          200, 3,
        ]);
        expect((await send("DELETE", path, "mainnet")).status).toBe(404);
        expect((await send("DELETE", path, "preprod")).status).toBe(200);
        expect(await preprod.creditCost.count(where)).toBe(0);
      } finally {
        for (const network of ["mainnet", "preprod"] as const) {
          await loaded
            .createNetworkScope(network)
            .networkDb.creditCost.deleteMany({ where: { id: rateId } });
        }
      }
    });

    it("serves shared data to preprod without access as without the header", async () => {
      for (const path of [
        "/v1/users/me",
        `/v1/users/${notOptedIn.id}/workspaces`,
      ]) {
        await call(loaded, path, { cookie: notOptedIn.cookie });
        await call(loaded, path, { cookie: notOptedIn.cookie });
        const none = await call(loaded, path, { cookie: notOptedIn.cookie });
        const preprod = await call(loaded, path, {
          cookie: notOptedIn.cookie,
          [HEADER]: "preprod",
        });
        expect([path, none.status]).toEqual([path, 200]);
        expect([path, preprod.status, preprod.body]).toEqual([
          path,
          none.status,
          none.body,
        ]);
      }
    });

    it("reads the access flag once, only for a Preprod request that needs it", {
      timeout: MANY_REQUESTS,
    }, async () => {
      const reads = async (headers: Record<string, string>) => {
        await call(loaded, "/v1/users/me", headers);
        await call(loaded, "/v1/users/me", headers);
        const none = await call(loaded, "/v1/users/me", headers);
        const mainnet = await call(loaded, "/v1/users/me", {
          ...headers,
          [HEADER]: "mainnet",
        });
        const preprod = await call(loaded, "/v1/users/me", {
          ...headers,
          [HEADER]: "preprod",
        });
        return [
          mainnet.statements - none.statements,
          preprod.statements - none.statements,
        ];
      };
      // The person's flag, the Organization's with the membership: one read.
      expect(await reads({ cookie: optedIn.cookie })).toEqual([0, 1]);
      expect(
        await reads({
          cookie: memberOfOptedIn.cookie,
          "X-Organization-Slug": optedInOrganization.slug,
        }),
      ).toEqual([0, 1]);
      // An admin's role is in the session: no read.
      expect(await reads({ cookie: admin.cookie })).toEqual([0, 0]);
      // The same for a token: its role is read with the token.
      expect(await reads(bearer(await oauthToken(optedIn.id)))).toEqual([0, 1]);
      expect(
        await reads({
          ...bearer(await oauthToken(memberOfOptedIn.id)),
          ...slug(optedInOrganization),
        }),
      ).toEqual([0, 1]);
      expect(await reads(bearer(await oauthToken(admin.id)))).toEqual([0, 0]);
      // A Preprod key is for Preprod without the header (one read); with
      // `mainnet` it is refused before any read.
      expect(await reads(await key(optedIn, "soko_preprod_"))).toEqual([-1, 0]);
      expect(await reads(await key(admin, "soko_preprod_"))).toEqual([0, 0]);
    });

    it("answers canUsePreprod per workspace", async () => {
      const canUse = async (who: Person) => {
        const { body } = await call(loaded, `/v1/users/${who.id}/workspaces`, {
          cookie: who.cookie,
        });
        return (
          body as {
            data: { workspaces: { kind: string; canUsePreprod: boolean }[] };
          }
        ).data.workspaces.map(({ kind, canUsePreprod }) => [
          kind,
          canUsePreprod,
        ]);
      };
      expect(await canUse(optedIn)).toEqual([["personal", true]]);
      expect(await canUse(notOptedIn)).toEqual([["personal", false]]);
      expect(await canUse(memberOfOptedIn)).toEqual([
        ["personal", false],
        ["organization", true],
      ]);
      expect(await canUse(memberOfNotOptedIn)).toEqual([
        ["personal", false],
        ["organization", false],
      ]);
      await loaded.prisma.member.create({
        data: {
          userId: admin.id,
          organizationId: notOptedInOrganization.id,
          role: "member",
        },
      });
      expect(await canUse(admin)).toEqual([
        ["personal", true],
        ["organization", true],
      ]);
    });
  },
);
