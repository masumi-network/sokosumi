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

import { onSplitLayout } from "@/test/split-layout";

const pools = vi.hoisted(() => [] as Pool[]);
/** Statements Core's pool sent: the database client decides what a read is. */
const sent = vi.hoisted(() => ({ statements: 0 }));
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
  const response = await loaded.app.request(`${ORIGIN}${path}`, {
    headers: { origin: ORIGIN, ...headers },
  });
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
        // Still on the default client, so their tables are not there on the
        // split layout until their tickets move them.
        ...(onSplitLayout ? [] : [`/v1/agents/${catalog.agentId}`, "/v1/jobs"]),
      ];
    }

    // The old Preprod: `NETWORK` is Preprod, Preprod off, one schema. Its
    // paid catalog keeps the deployment's `NETWORK` in the V2 and x402
    // filters (decision 9), so it must answer as before this ticket.
    it.runIf(deploymentNetwork === "Preprod" && !onSplitLayout)(
      "answers the old Preprod's paid catalog as before this ticket",
      async () => {
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
            key: "cardano-v2-rail-readiness",
            cursorId: JSON.stringify([
              { policyId: v2Policy, smartContractAddress: v2Address },
            ]),
          },
          {
            key: "x402-buy-side-readiness",
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
        const scope = loaded.createNetworkScope("mainnet");
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
            await call(loaded, path, {});
            const answer = await call(loaded, path, {});
            // The free fixture Agent's id, name and times are random.
            const free = JSON.stringify(answer)
              .replaceAll(catalog.agentId, "free-agent")
              .replaceAll(agentName, "free agent");
            answers[path] = JSON.parse(free, (key, value) =>
              value?.id === "free-agent"
                ? { ...value, createdAt: "free", updatedAt: "free" }
                : value,
            );
          }
          expect(answers).toEqual(OLD_PREPROD_CATALOG);
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
      },
    );

    it("reads for a Mainnet request what it read before this ticket", async () => {
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

    it("answers a key or token without the header as with mainnet, and every key as an old one", async () => {
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
          // The token is another credential: its answers and reads differ.
          if (name === "an OAuth token") continue;
          oldKey ??= none;
          expect([name, path, none]).toEqual([name, path, oldKey]);
        }
        expect([path, oldKey?.status]).toEqual([
          path,
          BEARER_STATUS[path] ?? 200,
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

    it("serves shared data to preprod as without the header, reading nothing more", async () => {
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

    it("refuses Network data to preprod with preprod_off, before any read", async () => {
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
        for (const path of ["/v1/agents", "/v1/credit-costs"]) {
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

    async function oauthToken(userId: string) {
      const { token, clientId } = await loaded.fixture.createOAuthToken(userId);
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

    it("lists each Network's own row for the same Agent id", async () => {
      expect(await listed({})).toEqual(allowed("mainnet"));
      expect(await listed({ [HEADER]: "mainnet" })).toEqual(allowed("mainnet"));
      expect(
        await listed({ cookie: admin.cookie, [HEADER]: "preprod" }),
      ).toEqual(allowed("preprod"));
    });

    it("opens the Preprod catalog to the callers that have access, and only to them", async () => {
      const slug = (organization: { slug: string }) => ({
        "X-Organization-Slug": organization.slug,
      });
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
        [
          "an admin's API key",
          {
            authorization: `Bearer ${await loaded.fixture.createApiKey(admin.id)}`,
          },
          refused,
        ],
        [
          "an opted-in person's API key",
          {
            authorization: `Bearer ${await loaded.fixture.createApiKey(optedIn.id)}`,
          },
          refused,
        ],
        [
          "an opted-in person's OAuth token",
          {
            authorization: `Bearer ${await oauthToken(optedIn.id)}`,
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
        // Without the header every one of them reads Mainnet.
        expect([caller, (await listed(headers)).names]).toEqual([
          caller,
          [names.mainnet],
        ]);
      }
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

    it("reads the access flag once, only for a Preprod request that needs it", async () => {
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
