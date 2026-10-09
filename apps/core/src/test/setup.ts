import { vi } from "vitest";

import { workerDatabaseUrl } from "./worker-database-url";

const envDefaults: Record<string, string> = {
  NETWORK: "Preprod",
  NODE_ENV: "development",
  PORT: "8787",
  DATABASE_URL: "https://example.com/database",
  BETTER_AUTH_SECRET: "test-secret",
  TURNSTILE_SECRET_KEY: "test-turnstile-secret",
  BETTER_AUTH_URL: "https://example.com/auth",
  BETTER_AUTH_RP_ID: "localhost",
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  MICROSOFT_CLIENT_ID: "test-microsoft-client-id",
  MICROSOFT_CLIENT_SECRET: "test-microsoft-client-secret",
  WEB_APP_BASE_URL: "https://example.com",
  RESEND_API_KEY: "test-resend-api-key",
  RESEND_FROM_EMAIL: "no-reply@example.com",
  PAYMENT_API_URL: "https://example.com/payment",
  PAYMENT_API_KEY: "test-payment-key",
  REGISTRY_API_URL: "https://example.com/registry",
  REGISTRY_API_KEY: "test-registry-key",
  SOKO_BOT_ENABLED: "true",
  SOKO_BOT_RUNTIME_ADAPTER: "in-memory",
  CRON_SECRET: "test-cron-secret",
  STRIPE_SECRET_KEY: "sk_test_example",
  STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID: "prod_starter_test",
  STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID: "prod_standard_test",
  STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID: "prod_pro_test",
  STRIPE_CREDIT_PRODUCT_ID: "prod_credit_test",
  SIGNUP_BONUS_CREDITS: "3000",
  SIGNUP_BONUS_TTL_DAYS: "30",
  STRIPE_WEBHOOK_SECRET: "whsec_test_example",
  LOCK_TIMEOUT: "900000",
  LOCK_TIMEOUT_BUFFER: "25000",
  INSTANCE_ID: "test-instance-id",
  SHOW_AGENTS_BY_DEFAULT: "true",
  MAINTENANCE_MODE: "false",
  COMPOSIO_X_AUTH_CONFIG_ID: "test-composio-x-auth-config-id",
  ABLY_PUBLISH_ONLY_KEY: "local-test",
  ABLY_SUBSCRIBE_ONLY_KEY: "local-test-subscribe",
  JOB_FAILURE_NOTIFICATION_EMAILS: "",
  OPENROUTER_CHAT_API_KEY:
    "sk-or-v1-test-0000000000000000000000000000000000000000",
  PROJECT_MEMORY_MODEL: "mistral/mistral-medium-3.5",
};

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
