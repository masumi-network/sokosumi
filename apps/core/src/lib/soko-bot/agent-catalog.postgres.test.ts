import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Hono } from "hono";
import type { Pool } from "pg";
import { afterAll, expect, it, vi } from "vitest";
import { sokoBotTurnReader } from "@/helpers/task-visibility";
import {
  forBotTool,
  nameOf,
  namesForClassifier,
  searchForBot,
} from "@/lib/agent-catalog/bot";
import type { NetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import type { AuthVariables } from "@/middleware/auth";
import {
  NETWORK_HEADER,
  type NetworkScopeVariables,
  networkScopeMiddleware,
} from "@/middleware/network-scope";
import { dispatchTasksTools } from "@/services/soko-bot-runtime/dispatch-tasks";
import type { RuntimeOperations } from "@/services/soko-bot-runtime/operations";
import type { AuthorizedSokoBotRuntime } from "@/services/soko-bot-runtime.service";
import { observing, statements } from "@/test/spend-comparison";
import { onSplitLayout } from "@/test/split-layout";
import { loadClassificationContext } from "./classification-context";
import { describeDecision } from "./decision-proposal";

const state = vi.hoisted(() => ({
  rail: "Mainnet" as "Mainnet" | "Preprod",
  preprodEnabled: false,
  pools: [] as Pool[],
  fetchAgentInputSchema: vi.fn().mockResolvedValue({
    isErr: () => false,
    value: { input_data: [] },
  }),
}));

vi.mock("@/config/env", async (load) => {
  const actual = await load<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      NETWORK: state.rail,
      NETWORK_PREPROD_ENABLED: state.preprodEnabled,
    }),
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
      actual.attachDatabasePool(pool);
    },
  };
});
vi.mock("@sokosumi/masumi", async (load) => ({
  ...(await load<typeof import("@sokosumi/masumi")>()),
  createAgentClient: () => ({
    fetchAgentInputSchema: state.fetchAgentInputSchema,
  }),
}));
vi.mock("@/lib/evals/eval-guard", async (load) => ({
  ...(await load<typeof import("@/lib/evals/eval-guard")>()),
  globalCoworkersFor: async () => [{ isWhitelisted: true }],
}));

afterAll(async () => {
  await Promise.all(state.pools.map((pool) => pool.end()));
});

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const recording = process.env.RECORD_SOKO_BOT_CATALOG_BASE === "true";
const baseFile = new URL("./agent-catalog.base.json", import.meta.url);
const reader = sokoBotTurnReader(
  "01960001-0001-7001-8001-000000000001",
  "OWNER",
  null,
);
const schema = { input_data: [] };
const directEndpoint = "https://direct.example.invalid";
const overrideEndpoint = "https://override.example.invalid";
const unit = "a".repeat(56);
const overrideOnly = "bot-catalog-override";
const hidden = "bot-catalog-hidden";
const offline = "bot-catalog-offline";
const missing = "bot-catalog-missing";
const direct = Array.from({ length: 50 }, (_, i) => `bot-catalog-${i + 10}`);

function dispatch(scope: NetworkScope, agentId: string) {
  return dispatchTasksTools(
    {} as RuntimeOperations,
    {
      capability: "get_agent_input_schema",
      input: { agentId },
      sessionId: "session",
      turnId: "turn",
      toolCallId: "tool-call",
    },
    { scope } as AuthorizedSokoBotRuntime,
  );
}

async function withRequestScope(
  header: "mainnet" | "preprod" | undefined,
  run: (scope: NetworkScope) => Promise<void>,
) {
  const app = new Hono<{
    Variables: Partial<AuthVariables & NetworkScopeVariables>;
  }>();
  app.onError((error) => {
    throw error;
  });
  if (state.preprodEnabled) {
    app.use(async (c, next) => {
      c.set("authContext", {
        actor: "user",
        userId: "catalog-admin",
        organizationId: null,
        role: "admin",
        authenticationMethod: "session",
      });
      await next();
    });
  }
  app.get("/", networkScopeMiddleware, async (c) => {
    if (!c.var.networkScope) throw new Error("No request Network scope");
    await run(c.var.networkScope);
    return c.body(null, 204);
  });
  const response = await app.request("/", {
    headers: header ? { [NETWORK_HEADER]: header } : {},
  });
  expect(response.status).toBe(204);
}

// Recorded from origin/main at 48866eb2b on today's layout.
const requests = [
  ["Mainnet", undefined],
  ["Mainnet", "mainnet"],
  ["Preprod", undefined],
  ["Preprod", "mainnet"],
] as const;

it
  .skipIf(!enabled)
  .each(
    onSplitLayout ? [...requests, ["Mainnet", "preprod"] as const] : requests,
  )(
  "preserves Soko Bot catalog results and SQL with deployment NETWORK=%s and request header %s",
  async (rail, header) => {
    state.rail = rail;
    state.preprodEnabled = header === "preprod";
    await withRequestScope(header, async (scope) => {
      state.fetchAgentInputSchema.mockClear();
      const db = scope.networkDb;
      const before = await db.agent.findMany({
        select: { id: true },
        orderBy: { id: "asc" },
      });
      const suffix = randomUUID();
      const nameOfFixture = (id: string) => `${id} ${suffix}`;
      const seeded: string[] = [];
      let rateId: string | undefined;
      // Job evidence is a separate reader still on the shared client.
      const job = vi.spyOn(prisma.job, "findMany").mockResolvedValue([]);
      const observations: Record<string, unknown> = {};
      async function capture<T>(label: string, run: () => Promise<T>) {
        const { outcome, log } = await observing(run);
        expect(log.length, label).toBeGreaterThan(0);
        const queries = statements(log);
        const outsideValues = statements(log, { asSent: true })
          .outsideTransactions.map(({ values }) => JSON.stringify(values))
          .sort();
        observations[label] = {
          outcome,
          count: log.length,
          ...queries,
          outsideValues,
        };
        return outcome;
      }

      try {
        expect(before).toEqual([]);
        for (const id of [...direct, overrideOnly, hidden, offline]) {
          const fixed = id === direct[0] || id === direct[49];
          await db.agent.create({
            data: {
              id,
              name: nameOfFixture(id),
              blockchainIdentifier: id,
              type: id === direct[0] ? "OPEN_API" : "STANDARD",
              apiBaseUrl: id === overrideOnly ? null : directEndpoint,
              isShown: id !== hidden,
              status: id === offline ? "OFFLINE" : "ONLINE",
              jobCount: id === direct[0] ? 7 : 5,
              lastUptimeCheck: new Date("2026-11-27T12:00:00Z"),
              uptimeCount: 1,
              uptimeCheckCount: 1,
              ...(id === overrideOnly && {
                metadataOverride: { create: { apiBaseUrl: overrideEndpoint } },
              }),
              pricing: {
                create: {
                  id: `${id}-price`,
                  pricingType: fixed ? "FIXED" : "FREE",
                  ...(fixed && {
                    fixedPricing: {
                      create: {
                        id: `${id}-fixed`,
                        amounts: {
                          create: {
                            id: `${id}-amount`,
                            amount: 3n,
                            unit: id === direct[0] ? unit : "b".repeat(56),
                          },
                        },
                      },
                    },
                  }),
                },
              },
            },
          });
          seeded.push(id);
        }

        const withoutRates = await capture("search before rate", () =>
          searchForBot(scope, 4),
        );
        expect(withoutRates).toMatchObject({
          count: 51,
          agents: [
            {
              id: direct[0],
              name: nameOfFixture(direct[0]),
              price: { credits: null },
            },
            { id: overrideOnly, name: nameOfFixture(overrideOnly) },
            { id: direct[49], name: nameOfFixture(direct[49]) },
            { id: direct[48], name: nameOfFixture(direct[48]) },
          ],
        });
        ({ id: rateId } = await db.creditCost.create({
          data: { unit, centsPerUnit: 5_000_000_000n },
        }));
        const search = await capture("search with rate", () =>
          searchForBot(scope, 4),
        );
        const searchIds = [direct[0], overrideOnly, direct[49], direct[48]];
        expect(search).toMatchObject({
          count: 51,
          agents: searchIds.map((id) => ({ id, name: nameOfFixture(id) })),
        });
        if ("threw" in search) throw new Error(JSON.stringify(search.threw));
        expect(search.agents[0].price.credits).toBe(1.5);
        expect(search.agents[2].price.credits).toBeNull();
        expect(
          await capture("packet count only", () => searchForBot(scope, 0)),
        ).toEqual({
          count: 51,
          agents: [],
        });

        await capture("classifier names", async () => {
          const result = await loadClassificationContext(
            scope,
            reader,
            "01960001-0001-7001-8001-000000000002",
            "",
          );
          const names = result.candidates.flatMap((row) =>
            row.kind === "AGENT" ? [{ id: row.id, name: row.name }] : [],
          );
          // PostgreSQL returns up to 50 without ORDER BY. Compare membership.
          expect(new Set(result.agentIds)).toEqual(new Set(direct));
          expect(names).toHaveLength(50);
          expect(new Set(names)).toEqual(
            new Set(direct.map((id) => ({ id, name: nameOfFixture(id) }))),
          );
          return names.sort((a, b) => a.id.localeCompare(b.id));
        });

        for (const id of [hidden, missing]) {
          expect(
            await capture(`approval ${id}`, () =>
              describeDecision(scope, "hire_agent", {
                agentId: id,
                inputSchema: schema,
                inputData: {},
                maxCredits: 3,
              }),
            ),
          ).toBe(
            `Hire Agent ${id === hidden ? `"${nameOfFixture(id)}"` : id} with a maximum of 3 credits`,
          );
        }

        expect(
          await capture("tool override", () => dispatch(scope, overrideOnly)),
        ).toEqual(schema);
        expect(state.fetchAgentInputSchema).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            id: overrideOnly,
            name: nameOfFixture(overrideOnly),
            apiBaseUrl: overrideEndpoint,
          }),
        );
        for (const [id, message] of [
          [hidden, "Agent not found"],
          [
            offline,
            "This Agent is not available to hire right now (offline). Pick another from find_agents.",
          ],
        ]) {
          expect(
            await capture(`tool ${id}`, () => dispatch(scope, id)),
          ).toMatchObject({
            threw: { message },
          });
        }
        expect(state.fetchAgentInputSchema).toHaveBeenCalledTimes(1);

        // Only fixture-name uniqueness and the SQL recorder's schema/whitespace
        // spelling differ. Keep Agent ids, ordered results and prices as read.
        const json = JSON.stringify(
          observations,
          (_key, value) =>
            typeof value === "bigint" ? value.toString() : value,
          2,
        ).replaceAll(suffix, "<run>");
        if (recording && rail === "Mainnet" && !header && !onSplitLayout) {
          writeFileSync(baseFile, `${json}\n`);
        } else if (header !== "preprod") {
          expect(JSON.parse(json)).toEqual(
            JSON.parse(readFileSync(baseFile, "utf8")),
          );
        }
      } finally {
        job.mockRestore();
        if (rateId) await db.creditCost.delete({ where: { id: rateId } });
        await db.agent.deleteMany({ where: { id: { in: seeded } } });
        await db.agentPricing.deleteMany({
          where: { id: { in: seeded.map((id) => `${id}-price`) } },
        });
        await db.unitValue.deleteMany({
          where: { id: { in: seeded.map((id) => `${id}-amount`) } },
        });
        await db.agentFixedPricing.deleteMany({
          where: { id: { in: seeded.map((id) => `${id}-fixed`) } },
        });
      }
      expect(
        await db.agent.findMany({
          select: { id: true },
          orderBy: { id: "asc" },
        }),
      ).toEqual(before);
    });
  },
  30_000,
);

it.skipIf(!enabled)(
  "refuses a flag-off Preprod catalog read before sending SQL",
  async () => {
    state.preprodEnabled = false;
    await withRequestScope("preprod", async (scope) => {
      for (const read of [
        () => searchForBot(scope, 4),
        () => namesForClassifier(scope),
        () => nameOf(scope, hidden),
        () => forBotTool(scope, hidden),
      ]) {
        const { outcome, log } = await observing(async () => read());
        expect(outcome).toMatchObject({
          threw: { status: 403, message: "Preprod is switched off" },
        });
        expect(log).toEqual([]);
      }
    });
  },
);
