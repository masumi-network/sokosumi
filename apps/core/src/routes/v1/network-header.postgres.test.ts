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
  return { fixture, prisma, createNetworkScope, app: fixture.createCoreApp() };
}

type Loaded = Awaited<ReturnType<typeof load>>;

interface Answer {
  status: number;
  body: unknown;
  statements: number;
}

/** One request; the body without `meta`, which carries a time and an id. */
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
  if (body && typeof body === "object") delete body.meta;
  return { status: response.status, body, statements };
}

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

    async function person(name: string, role?: string) {
      const user = await loaded.fixture.createPasswordUser(name, role);
      userIds.push(user.id);
      // A personal workspace, so a new session opens it and needs no seat.
      await loaded.prisma.workspace.create({ data: { userId: user.id } });
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

    beforeAll(async () => {
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
    });

    afterAll(async () => {
      await catalog.remove();
      await loaded.prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      await loaded.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    });

    /**
     * The first reads of a path can write once (an Organization's missing
     * workspace row; the Task list's second read), so counts start after two.
     */
    async function warm(path: string, cookie: string) {
      await call(loaded, path, { cookie });
      await call(loaded, path, { cookie });
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
    const agentId = randomUUID();
    const names = {
      mainnet: `Mainnet agent ${agentId}`,
      preprod: `Preprod agent ${agentId}`,
    };
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
      await loaded.prisma.workspace.create({ data: { userId: user.id } });
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

    beforeAll(async () => {
      loaded = await load({ NETWORK_PREPROD_ENABLED: "true" });
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
      notOptedInOrganization = await organization(memberOfNotOptedIn.id, false);
    });

    afterAll(async () => {
      for (const remove of removals) await remove();
      await loaded.prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      await loaded.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    });

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
            authorization: `Bearer ${await loaded.fixture.createOAuthToken(optedIn.id)}`,
          },
          refused,
        ],
        [
          "a Coworker key",
          {
            authorization: `Bearer ${await loaded.fixture.createCoworkerKey()}`,
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
      expect(answer.status).toBe(403);
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
