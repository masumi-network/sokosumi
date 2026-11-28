import { installConsoleGuard } from "@sokosumi/utils/test-console";
import { vi } from "vitest";
import { installCoreLogDrain } from "./core-log";
import { envDefaults } from "./env-defaults";
import { installWaitUntilDrain } from "./wait-until";
import { workerDatabaseUrl } from "./worker-database-url";

for (const [key, value] of Object.entries(envDefaults)) {
  // Opt-in DB integration suites supply a real Postgres URL. Do not clobber it
  // with the unit-test placeholder or those tests can never connect.
  if (
    key === "DATABASE_URL" &&
    process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
    process.env.DATABASE_URL?.startsWith("postgres")
  ) {
    continue;
  }
  process.env[key] = value;
}

// The parallel PostgreSQL run gives each worker its own copy of the migrated
// database (`postgres-worker-databases.ts`); point this worker at its copy.
const poolId = process.env.VITEST_POOL_ID;
if (process.env.POSTGRES_TEST_DATABASE_PER_WORKER === "true" && poolId) {
  // Keep the idle migrated template available to suites that need a private copy.
  process.env.POSTGRES_TEST_TEMPLATE_URL = process.env.DATABASE_URL;
  for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
    const url = process.env[key];
    if (url?.startsWith("postgres")) {
      process.env[key] = workerDatabaseUrl(url, poolId);
    }
  }
}

// Tests use BETTER_AUTH_SECRET alone. A BETTER_AUTH_SECRETS value from the
// shell would switch Better Auth to versioned keys.
delete process.env.BETTER_AUTH_SECRETS;

// Unit tests run on today's layout, every schema `public` and Preprod off,
// whatever the shell says. A PostgreSQL run keeps the names and the flag, so it
// can run against the split layout.
if (process.env.RUN_DATABASE_INTEGRATION_TESTS !== "true") {
  delete process.env.DATABASE_SCHEMA_SHARED;
  delete process.env.DATABASE_SCHEMA_MAINNET;
  delete process.env.DATABASE_SCHEMA_PREPROD;
  delete process.env.NETWORK_PREPROD_ENABLED;
}

// `@sentry/node` costs ~350ms to load in every test file that reaches it, and
// helpers import it directly to report errors. A file that asserts on Sentry
// mocks it itself, which takes precedence over this stub.
vi.mock("@sentry/node", () => {
  // Any scope method (setTag, setContext, setTransactionName, …) is a no-op.
  const scope: Record<string, unknown> = new Proxy(
    {},
    {
      // Not `then`: an awaited scope must not look like a promise.
      get: (target: Record<string, unknown>, key: string) =>
        key === "then" ? undefined : (target[key] ??= vi.fn()),
    },
  );
  return {
    init: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    captureCheckIn: vi.fn(() => "check-in-id"),
    flush: vi.fn(async () => true),
    addBreadcrumb: vi.fn(),
    getCurrentScope: () => scope,
    getActiveSpan: () => undefined,
    withScope: (callback: (s: typeof scope) => unknown) => callback(scope),
    withIsolationScope: (callback: (s: typeof scope) => unknown) =>
      callback(scope),
    startSpan: (_options: unknown, callback: (span: undefined) => unknown) =>
      callback(undefined),
    httpIntegration: () => ({}),
    requestDataIntegration: () => ({}),
  };
});

// Better Auth seeds the MCP resource row whenever Core's `auth` starts (ADR
// 0076), and many route tests load `auth`. A unit run has no database, so
// that one table answers here, as if the row exists: startup never reaches
// the placeholder `DATABASE_URL`, which fails at error level in CI and hangs
// locally. A file that mocks Prisma itself takes precedence; a mock without
// `oauthResource` reads as a table not created yet, which Better Auth skips
// quietly. A run against PostgreSQL keeps the real client.
vi.mock("@/lib/db/prisma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/prisma")>();
  if (process.env.DATABASE_URL?.startsWith("postgres")) {
    return actual;
  }
  const row = ({ where }: { where: { identifier: string } }) =>
    Promise.resolve({ id: "mcp-resource", identifier: where.identifier });
  const oauthResource = { findFirst: row, update: row };
  return {
    ...actual,
    default: new Proxy(actual.default, {
      get: (target, key) =>
        key === "oauthResource" ? oauthResource : Reflect.get(target, key),
    }),
  };
});

installConsoleGuard();
// The test drain owns evlog's setup here: `lib/evlog-init.ts`, which
// `config/env.ts` imports, must neither start Core's logger over it nor read
// `@/lib/evlog`, which 16 files mock without `initCoreLogger`. Its own test
// clears this flag.
(globalThis as Record<symbol, unknown>)[
  Symbol.for("sokosumi.core.logger-started")
] = true;
await installCoreLogDrain();
installWaitUntilDrain();
