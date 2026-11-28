// The admin Agent and rate routes as `origin/main` at e8e19a5d9 answers them,
// with the same routes, seed and clock. RECORD_ADMIN_CATALOG_BASE=true writes
// the public-layout recording.
import "@hono/zod-openapi";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Hono } from "hono";
import type { Pool } from "pg";
import { afterAll, expect, it, vi } from "vitest";
import { copyPostgresTestDatabase } from "@/test/postgres-database-copy";
import { observing, statements } from "@/test/spend-comparison";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

// Core runs in UTC in production and in CI. The Agent detail's run-time
// cutoff is "now" minus 90 days in the process's own zone, so a recording
// made in a zone with summer time binds another hour. Before any Date exists.
vi.hoisted(() => {
  process.env.TZ = "UTC";
});

const state = vi.hoisted(() => ({
  network: "Mainnet" as "Mainnet" | "Preprod",
  pools: [] as Pool[],
  work: [] as Promise<unknown>[],
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
    waitUntil: (work: Promise<unknown>) => state.work.push(work),
    attachDatabasePool: (pool: Pool) => {
      state.pools.push(pool);
      observePool(pool);
      actual.attachDatabasePool(pool);
    },
  };
});
const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";

/**
 * Every row of every table of this run's schemas, each as its JSON, sorted.
 * Read on a connection of its own, outside Core's observed pool.
 */
async function everyRow(url: string) {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const schemas = [...new Set(Object.values(testSchemaNames()))];
    const { rows: tables } = await client.query<{
      table_schema: string;
      table_name: string;
    }>(
      `SELECT table_schema, table_name FROM information_schema.tables
       WHERE table_type = 'BASE TABLE' AND table_schema = ANY($1)
       ORDER BY table_schema, table_name`,
      [schemas],
    );
    const rows: Record<string, string[]> = {};
    for (const { table_schema: schema, table_name: table } of tables) {
      // Identifiers cannot be bound; both come from the catalog above.
      const name = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
      const result = await client.query<{ row: string }>(
        `SELECT to_jsonb(t)::text AS row FROM ${name} t`,
      );
      rows[`${schema}.${table}`] = result.rows.map(({ row }) => row).sort();
    }
    return rows;
  } finally {
    await client.end();
  }
}

/**
 * Core, imported only once `DATABASE_URL` names the private copy: Better
 * Auth writes its OAuth resource when the module loads.
 */
async function loadCore() {
  const [scope, evlog, workspace, session] = await Promise.all([
    import("@/lib/db/network-scope"),
    import("@/lib/evlog"),
    import("@/helpers/personal-workspace"),
    import("@/test-fixtures/core-session"),
  ]);
  return {
    createNetworkScope: scope.createNetworkScope,
    coreEvlogMiddleware: evlog.coreEvlogMiddleware,
    createPersonalWorkspace: workspace.createPersonalWorkspace,
    createApiKey: session.createApiKey,
    createCoreApp: session.createCoreApp,
    createPasswordUser: session.createPasswordUser,
  };
}
let core: Awaited<ReturnType<typeof loadCore>>;

/**
 * The run's database is only read: every row of it is taken before anything
 * else and compared after the file. Everything this file writes, Better
 * Auth's start included, goes to a private copy of the migrated template
 * with an empty catalog, so no rate or Agent of another file enters the
 * availability SQL the recording binds.
 */
if (enabled) {
  const given = process.env.DATABASE_URL;
  if (!given) throw new Error("The admin catalog recording needs PostgreSQL");
  const before = await everyRow(given);
  const copy = await copyPostgresTestDatabase(
    process.env.POSTGRES_TEST_TEMPLATE_URL ?? given,
    "catalog_test",
  );
  afterAll(async () => {
    try {
      await Promise.all(state.pools.map((pool) => pool.end()));
    } finally {
      vi.unstubAllEnvs();
      await copy.drop();
    }
    expect(await everyRow(given)).toEqual(before);
  }, 120_000);
  vi.stubEnv("DATABASE_URL", copy.url);
  vi.stubEnv("DATABASE_URL_UNPOOLED", copy.url);
  const { Client } = await import("pg");
  const names = testSchemaNames();
  const network = names.DATABASE_SCHEMA_MAINNET;
  const client = new Client({ connectionString: copy.url });
  await client.connect();
  try {
    await client.query(`TRUNCATE "${network}"."Agent", "${network}"."AgentPricing",
      "${network}"."AgentFixedPricing", "${network}"."CreditCost",
      "${network}"."Category", "${network}"."Tag",
      "${names.DATABASE_SCHEMA_SHARED}"."sync_metadata" CASCADE`);
  } finally {
    await client.end();
  }
  core = await loadCore();
}

const clock = new Date("2026-11-27T12:00:00.000Z");
const createdAt = new Date("2026-11-25T01:02:03.456Z");
const laterAt = new Date("2026-11-25T09:00:00.000Z");
const updatedAt = new Date("2026-11-26T04:05:06.789Z");
const recording = process.env.RECORD_ADMIN_CATALOG_BASE === "true";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

// Registry name, override name (or none), status, createdAt, priced.
const fixtures = [
  ["a", "Zeta", "Alpha", "ONLINE", createdAt, true],
  ["b", "Beta", null, "ONLINE", createdAt, true],
  ["c", "Gamma", "Delta", "OFFLINE", createdAt, false],
  ["d", "Alpha", null, "OFFLINE", laterAt, false],
  ["e", "Epsilon", null, "ONLINE", laterAt, false],
] as const;

/**
 * One run of every admin route with one header, on rows only this run owns:
 * each value that names them carries `run`, which `labels` turns back into
 * fixed names before anything is compared.
 */
async function scenario(
  app: Hono,
  token: string,
  header: "absent" | "mainnet",
  labels: Map<string, string>,
) {
  const scope = core.createNetworkScope("mainnet");
  const run = randomUUID().slice(0, 8);
  const prefix = `adm${run}`;
  labels.set(prefix, "adm");
  const agentId = (suffix: string) => `${prefix}-${suffix}`;
  const unit = `${prefix}unit`;
  const records: Record<string, unknown> = {};
  const createdRates: string[] = [];
  const tagNames = [`${prefix}-tag-z`, `${prefix}-tag-a`];
  const createdTags: string[] = [];

  async function call(
    label: string,
    method: string,
    path: string,
    body?: unknown,
  ) {
    const { outcome, log } = await observing(async () => {
      const response = await app.request(path, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(header === "mainnet" && { "X-Sokosumi-Network": header }),
          ...(body !== undefined && { "content-type": "application/json" }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      await Promise.all(state.work.splice(0));
      return { status: response.status, body: text };
    });
    if ("threw" in outcome) throw new Error(JSON.stringify(outcome.threw));
    // Every request reads at least its bearer: an empty log is a broken
    // recorder, never an answer.
    expect(log.length, label).toBeGreaterThan(0);
    // Each statement with its values, as sent; only the schema names of the
    // split layout are written as today's.
    const grouped = statements(log, { asSent: true });
    const plainSql = ({ sql, values }: { sql: string; values: unknown[] }) => ({
      sql: sql.replace(/"(shared|mainnet)"\./g, '"public".'),
      values,
    });
    records[label] = {
      status: outcome.status,
      body: outcome.body,
      count: log.length,
      transactions: grouped.transactions.map((tx) => tx.map(plainSql)),
      outside: grouped.outsideTransactions.map(plainSql),
    };
    return JSON.parse(outcome.body) as {
      data?: unknown;
      meta?: { pagination?: { nextCursor?: string | null } };
    };
  }

  // Raw facts read before any id is numbered: the order of the example
  // outputs a patch wrote, against the order they were sent and their ids.
  async function exampleOutputFacts(label: string, sent: string[]) {
    const rows = await scope.networkDb.exampleOutput.findMany({
      where: { metadataOverride: { agentId: agentId("b") } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const byId = [...rows].sort((x, y) => (x.id < y.id ? -1 : 1));
    records[`${label} example outputs`] = {
      readOrder: rows.map((row) => row.name),
      sentOrder: sent,
      idOrderIsReadOrder: byId.every((row, at) => row.id === rows[at]?.id),
      oneCreatedAt: new Set(rows.map((row) => row.createdAt.getTime())).size,
      createdAtIsClock: rows.every(
        (row) => row.createdAt.getTime() === clock.getTime(),
      ),
    };
  }

  try {
    await scope.netTransaction(async (tx) => {
      for (const [suffix, name, override, status, at, priced] of fixtures) {
        await tx.agent.create({
          data: {
            id: agentId(suffix),
            name: `${prefix} ${name}`,
            description: "Admin catalog fixture",
            blockchainIdentifier: `${prefix}-chain-${suffix}`,
            createdAt: at,
            updatedAt,
            lastUptimeCheck: at,
            uptimeCount: 1,
            uptimeCheckCount: 1,
            status,
            isShown: true,
            apiBaseUrl: "https://agent.example.com",
            pricing: {
              create: priced
                ? {
                    id: `${agentId(suffix)}-pricing`,
                    pricingType: "FIXED",
                    fixedPricing: {
                      create: {
                        id: `${agentId(suffix)}-fixed`,
                        amounts: {
                          create: {
                            id: `${agentId(suffix)}-amount`,
                            unit,
                            amount: suffix === "a" ? 3_000_000n : 5_000_000n,
                          },
                        },
                      },
                    },
                  }
                : { id: `${agentId(suffix)}-pricing`, pricingType: "FREE" },
            },
            ...(override && {
              metadataOverride: {
                create: {
                  id: `${agentId(suffix)}-override`,
                  name: `${prefix} ${override}`,
                  createdAt: at,
                  updatedAt,
                },
              },
            }),
          },
        });
      }
      // Never an empty rate table, whatever other files left: an Agent
      // without a rate for its unit is then unavailable, not a 500.
      const other = await tx.creditCost.create({
        data: {
          unit: `${prefix}other`,
          centsPerUnit: 1n,
          createdAt,
          updatedAt,
        },
      });
      createdRates.push(other.id);
      // Out of lexical order: the rate list answers them as the table holds
      // them, and its full response is recorded.
      for (const [suffix, cents] of [
        ["z", 3n],
        ["a", 2n],
        ["m", 4n],
      ] as const) {
        const rate = await tx.creditCost.create({
          data: {
            unit: `${prefix}${suffix}`,
            centsPerUnit: cents,
            createdAt,
            updatedAt,
          },
        });
        createdRates.push(rate.id);
      }
    }, "Fixture conflict");

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(clock);
    const q = `q=${prefix}`;

    // Lists: every sort, both directions, a filter, and a walk by cursor.
    for (const sortBy of [
      "displayName",
      "registryName",
      "hasOverride",
      "status",
      "createdAt",
    ]) {
      for (const sortOrder of ["asc", "desc"]) {
        let cursor: string | null | undefined;
        let page = 1;
        do {
          const at = cursor ? `&cursor=${cursor}` : "";
          const body = await call(
            `list ${sortBy} ${sortOrder} page ${page}`,
            "GET",
            `/v1/admin/agents?${q}&sortBy=${sortBy}&sortOrder=${sortOrder}&limit=2${at}`,
          );
          cursor = body.meta?.pagination?.nextCursor;
          page += 1;
        } while (cursor);
      }
    }
    await call(
      "list displayName online",
      "GET",
      `/v1/admin/agents?${q}&sortBy=displayName&sortOrder=asc&status=ONLINE`,
    );
    await call(
      "list createdAt offline",
      "GET",
      `/v1/admin/agents?${q}&sortBy=createdAt&sortOrder=desc&status=OFFLINE`,
    );
    await call(
      "list override name",
      "GET",
      `/v1/admin/agents?q=${prefix}%20Delta&sortBy=displayName&sortOrder=asc`,
    );
    await call(
      "list missing cursor",
      "GET",
      `/v1/admin/agents?${q}&sortBy=displayName&sortOrder=asc&cursor=${prefix}-none`,
    );

    // Detail.
    await call(
      "detail with override",
      "GET",
      `/v1/admin/agents/${agentId("a")}`,
    );
    await call("detail missing", "GET", `/v1/admin/agents/${prefix}-none`);

    // Override patch: create, replace, keep, prune; then delete.
    const firstOutputs = ["three", "one", "two"];
    await call(
      "patch create",
      "PATCH",
      `/v1/admin/agents/${agentId("b")}/metadata-override`,
      {
        name: `${prefix} Override`,
        description: "Overridden",
        tags: tagNames,
        exampleOutputs: firstOutputs.map((name) => ({
          name,
          mimeType: "text/plain",
          url: `https://example.com/${name}`,
        })),
      },
    );
    await exampleOutputFacts("patch create", firstOutputs);
    for (const tag of await scope.networkDb.tag.findMany({
      where: { name: { in: tagNames } },
      select: { id: true },
    })) {
      createdTags.push(tag.id);
    }
    const secondOutputs = ["b", "c", "a", "d"];
    await call(
      "patch replace",
      "PATCH",
      `/v1/admin/agents/${agentId("b")}/metadata-override`,
      {
        apiBaseUrl: "https://override.example.com",
        tags: [tagNames[1]],
        exampleOutputs: secondOutputs.map((name) => ({
          name,
          mimeType: "image/png",
          url: `https://example.com/${name}.png`,
        })),
      },
    );
    await exampleOutputFacts("patch replace", secondOutputs);
    await call(
      "patch keep collections",
      "PATCH",
      `/v1/admin/agents/${agentId("b")}/metadata-override`,
      { description: null },
    );
    await exampleOutputFacts("patch keep collections", secondOutputs);
    await call(
      "patch prune",
      "PATCH",
      `/v1/admin/agents/${agentId("b")}/metadata-override`,
      {
        name: null,
        apiBaseUrl: null,
        tags: [],
        exampleOutputs: [],
      },
    );
    await call(
      "patch missing",
      "PATCH",
      `/v1/admin/agents/${prefix}-none/metadata-override`,
      { name: "x" },
    );
    await call(
      "delete override",
      "DELETE",
      `/v1/admin/agents/${agentId("a")}/metadata-override`,
    );
    await call(
      "delete override again",
      "DELETE",
      `/v1/admin/agents/${agentId("a")}/metadata-override`,
    );
    await call(
      "delete override missing",
      "DELETE",
      `/v1/admin/agents/${prefix}-none/metadata-override`,
    );

    // Rates, and the price of the two Agents priced in the rate's unit.
    async function prices(label: string, maxCredits: number) {
      for (const suffix of ["a", "b"]) {
        await call(
          `${label} detail ${suffix}`,
          "GET",
          `/v1/agents/${agentId(suffix)}`,
        );
      }
      // The hire's lookup still reads the default client, which has no
      // Agent table on the split layout (pull request 3 of the catalog).
      if (onSplitLayout) return;
      await call(
        `${label} hire under the price`,
        "POST",
        `/v1/agents/${agentId("a")}/jobs`,
        {
          inputSchema: { input_data: [] },
          inputData: {},
          maxCredits,
        },
      );
    }
    await call("rate missing", "GET", `/v1/credit-costs/${prefix}-none`);
    await prices("no rate", 59);
    const created = (await call("rate create", "POST", "/v1/credit-costs", {
      unit: `  ${unit.toUpperCase()}\t`,
      creditsPerUnit: 0.00002,
    })) as { data: { id: string } };
    const rateId = created.data.id;
    createdRates.push(rateId);
    const [stored] = await scope.networkDb.$queryRaw<{ unit: string }[]>`
      SELECT unit FROM ${scope.networkTable("CreditCost")} WHERE id = ${rateId}`;
    records["rate create stored unit"] = stored?.unit.replace(prefix, "adm");
    await call("rate duplicate", "POST", "/v1/credit-costs", {
      unit: `Adm${run}Unit`,
      creditsPerUnit: 1,
    });
    await call("rate read", "GET", `/v1/credit-costs/${rateId}`);
    await call("rate list", "GET", "/v1/credit-costs");
    // 3 and 5 units at 20 credits a unit: 60 and 100. The hire refuses 59.
    await prices("first rate", 59);
    await call("rate update", "PATCH", `/v1/credit-costs/${rateId}`, {
      creditsPerUnit: 0.00005,
    });
    // The same Agents at 50 credits a unit: 150 and 250. 149 now refuses.
    await prices("updated rate", 149);
    await call(
      "rate update missing",
      "PATCH",
      `/v1/credit-costs/${prefix}-none`,
      {
        creditsPerUnit: 1,
      },
    );
    await call("rate delete", "DELETE", `/v1/credit-costs/${rateId}`);
    await call("rate delete again", "DELETE", `/v1/credit-costs/${rateId}`);
    await call("rate read deleted", "GET", `/v1/credit-costs/${rateId}`);
    await call("rate list after delete", "GET", "/v1/credit-costs");
    await prices("deleted rate", 149);
  } finally {
    vi.useRealTimers();
    const ids = fixtures.map(([suffix]) => agentId(suffix));
    const priced = fixtures
      .filter((fixture) => fixture[5])
      .map(([suffix]) => agentId(suffix));
    await scope.netTransaction(async (tx) => {
      // The override and its example outputs go with their Agent.
      await tx.agent.deleteMany({ where: { id: { in: ids } } });
      await tx.agentPricing.deleteMany({
        where: { id: { in: ids.map((id) => `${id}-pricing`) } },
      });
      await tx.unitValue.deleteMany({
        where: { id: { in: priced.map((id) => `${id}-amount`) } },
      });
      await tx.agentFixedPricing.deleteMany({
        where: { id: { in: priced.map((id) => `${id}-fixed`) } },
      });
      await tx.tag.deleteMany({ where: { id: { in: createdTags } } });
      await tx.creditCost.deleteMany({ where: { id: { in: createdRates } } });
    }, "Fixture conflict");
  }
  return records;
}

/**
 * Run values become fixed names; then each id the database made becomes
 * `<id n>` in the order it first appears, so equal ids stay equal and the
 * order they were sent in stays visible. Times and cursors stay raw.
 */
function named(records: unknown, labels: Map<string, string>) {
  let text = JSON.stringify(records);
  for (const [value, name] of labels) text = text.replaceAll(value, name);
  const made = new Map<string, string>();
  text = text.replace(UUID, (id) => {
    if (!made.has(id)) made.set(id, `<id ${made.size + 1}>`);
    return made.get(id) ?? id;
  });
  return JSON.parse(text) as unknown;
}

interface Recorded {
  transactions?: { sql: string; values: unknown[] }[][];
  outside?: { sql: string; values: unknown[] }[];
}

/**
 * Each statement text once, each identical record once: the same statements
 * in the same order, each answer as sent.
 */
function interned(runs: Record<string, unknown>) {
  const sql: string[] = [];
  const results: string[] = [];
  const calls: Record<string, number> = {};
  const at = (table: string[], value: string) => {
    const index = table.indexOf(value);
    return index === -1 ? table.push(value) - 1 : index;
  };
  for (const [header, records] of Object.entries(runs)) {
    for (const [label, value] of Object.entries(
      records as Record<string, Recorded>,
    )) {
      const record =
        value && typeof value === "object" && "transactions" in value
          ? {
              ...value,
              transactions: value.transactions?.map((tx) =>
                tx.map((s) => [at(sql, s.sql), s.values]),
              ),
              // Statements outside a transaction can run side by side: each
              // with its values, as a multiset.
              outside: (value.outside ?? [])
                .map((s) => JSON.stringify([s.sql, s.values]))
                .sort()
                .map((text) => {
                  const [statement, values] = JSON.parse(text) as [
                    string,
                    unknown[],
                  ];
                  return [at(sql, statement), values];
                }),
            }
          : value;
      calls[`${label}/${header}`] = at(results, JSON.stringify(record));
    }
  }
  return { sql, results: results.map((row) => JSON.parse(row)), calls };
}

type Interned = ReturnType<typeof interned>;

// Every call with its own record and statement texts, for a comparison that
// leaves some calls out.
function resolved({ sql, results, calls }: Interned) {
  return Object.fromEntries(
    Object.entries(calls).map(([label, index]) => {
      const record = results[index] as {
        transactions?: [number, unknown][][];
        outside?: [number, unknown][];
      };
      return [
        label,
        {
          ...record,
          ...(record.transactions && {
            transactions: record.transactions.map((tx) =>
              tx.map(([text, values]) => [sql[text], values]),
            ),
            outside: record.outside?.map(([text, values]) => [
              sql[text],
              values,
            ]),
          }),
        },
      ];
    }),
  );
}

function withoutHire(records: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(records).filter(([label]) => !label.includes(" hire ")),
  );
}

it.skipIf(!enabled).each(["Mainnet", "Preprod"] as const)(
  "preserves admin catalog responses and SQL with deployment NETWORK=%s",
  async (network) => {
    state.network = network;
    const shared = core.createNetworkScope("mainnet").sharedDb;
    const app = new Hono();
    app.use(core.coreEvlogMiddleware());
    app.use(async (c, next) => {
      c.set("requestId", "admin-catalog-request");
      await next();
    });
    app.route("/", core.createCoreApp());
    const admin = await core.createPasswordUser("Admin catalog", "admin");
    try {
      const workspace = await core.createPersonalWorkspace(admin.id);
      const token = await core.createApiKey(admin.id);
      const key = await shared.apikey.findFirstOrThrow({
        where: { referenceId: admin.id },
      });
      // About 90 requests under one frozen minute: past the per-minute limit.
      await shared.apikey.update({
        where: { id: key.id },
        data: { rateLimitEnabled: false },
      });
      const labels = new Map([
        [admin.id, "<admin>"],
        [key.id, "<api key>"],
        [key.key, "<api key hash>"],
        [workspace.id, "<workspace>"],
      ]);
      // Warm the bearer’s workspace, auth and each router's first-use reads
      // before counting database reads.
      for (let warm = 0; warm < 2; warm++) {
        for (const path of [
          "/v1/users/me",
          "/v1/agents?limit=1",
          "/v1/admin/agents/admin-catalog-none",
          "/v1/credit-costs/admin-catalog-none",
        ]) {
          await app.request(path, {
            headers: { authorization: `Bearer ${token}` },
          });
          await Promise.all(state.work.splice(0));
        }
      }
      const result = interned({
        absent: named(await scenario(app, token, "absent", labels), labels),
        mainnet: named(await scenario(app, token, "mainnet", labels), labels),
      });
      const path = new URL(
        `./admin-catalog-${network.toLowerCase()}.base.json`,
        import.meta.url,
      );
      if (recording) {
        expect(onSplitLayout).toBe(false);
        writeFileSync(path, JSON.stringify(result, null, 2) + "\n");
      } else {
        const base = JSON.parse(readFileSync(path, "utf8")) as typeof result;
        if (onSplitLayout) {
          expect(resolved(result)).toEqual(withoutHire(resolved(base)));
        } else {
          expect(result).toEqual(base);
        }
      }
    } finally {
      await shared.apikey.deleteMany({ where: { referenceId: admin.id } });
      await shared.subscription.deleteMany({
        where: { referenceId: admin.id },
      });
      await shared.user.delete({ where: { id: admin.id } });
    }
  },
  120_000,
);

// The one change from `origin/main`: there these routes ignored the request's
// Network and answered from the default client's tables. Now a request naming
// Preprod while Preprod is off gets the scope's refusal and touches no row.
it.skipIf(!enabled || onSplitLayout)(
  "refuses every admin Agent and rate route for Preprod while it is off",
  async () => {
    state.network = "Mainnet";
    const scope = core.createNetworkScope("mainnet");
    const app = core.createCoreApp();
    const admin = await core.createPasswordUser(
      "Admin catalog refusal",
      "admin",
    );
    const prefix = `adm${randomUUID().slice(0, 8)}`;
    let rateId: string | undefined;
    try {
      await core.createPersonalWorkspace(admin.id);
      const token = await core.createApiKey(admin.id);
      await scope.networkDb.agent.create({
        data: {
          id: prefix,
          name: prefix,
          description: "Admin catalog fixture",
          blockchainIdentifier: prefix,
          lastUptimeCheck: createdAt,
          uptimeCount: 1,
          uptimeCheckCount: 1,
          isShown: true,
          pricing: { create: { id: `${prefix}-pricing`, pricingType: "FREE" } },
        },
      });
      const rate = await scope.networkDb.creditCost.create({
        data: { unit: `${prefix}unit`, centsPerUnit: 7n },
      });
      rateId = rate.id;
      const requests: [string, string, unknown?][] = [
        ["GET", `/v1/admin/agents?q=${prefix}&sortBy=displayName`],
        ["GET", `/v1/admin/agents?q=${prefix}&sortBy=createdAt`],
        ["GET", `/v1/admin/agents/${prefix}`],
        [
          "PATCH",
          `/v1/admin/agents/${prefix}/metadata-override`,
          { name: "x" },
        ],
        ["DELETE", `/v1/admin/agents/${prefix}/metadata-override`],
        [
          "POST",
          "/v1/credit-costs",
          { unit: `${prefix}new`, creditsPerUnit: 1 },
        ],
        ["GET", `/v1/credit-costs/${rate.id}`],
        ["PATCH", `/v1/credit-costs/${rate.id}`, { creditsPerUnit: 9 }],
        ["DELETE", `/v1/credit-costs/${rate.id}`],
      ];
      for (const [method, path, body] of requests) {
        const response = await app.request(path, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            "X-Sokosumi-Network": "preprod",
            ...(body !== undefined && { "content-type": "application/json" }),
          },
          ...(body !== undefined && { body: JSON.stringify(body) }),
        });
        expect([method, path, response.status]).toEqual([method, path, 403]);
        expect(await response.json()).toMatchObject({ kind: "preprod_off" });
      }
      expect(
        await scope.networkDb.agentMetadataOverride.count({
          where: { agentId: prefix },
        }),
      ).toBe(0);
      expect(
        await scope.networkDb.creditCost.findMany({
          where: { unit: { startsWith: prefix } },
          select: { id: true, centsPerUnit: true },
        }),
      ).toEqual([{ id: rate.id, centsPerUnit: 7n }]);
    } finally {
      await scope.networkDb.agent.deleteMany({ where: { id: prefix } });
      await scope.networkDb.agentPricing.deleteMany({
        where: { id: `${prefix}-pricing` },
      });
      if (rateId) {
        await scope.networkDb.creditCost.deleteMany({
          where: { id: rateId },
        });
      }
      await scope.sharedDb.apikey.deleteMany({
        where: { referenceId: admin.id },
      });
      await scope.sharedDb.subscription.deleteMany({
        where: { referenceId: admin.id },
      });
      await scope.sharedDb.user.delete({ where: { id: admin.id } });
    }
  },
  60_000,
);
