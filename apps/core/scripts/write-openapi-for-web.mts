/**
 * Writes the v1 OpenAPI document for web client codegen without running the
 * HTTP server. Several route modules instantiate Prisma at import time, so
 * required env vars must be set first (mirrors `src/test/setup.ts`).
 *
 *   pnpm --filter core exec tsx scripts/write-openapi-for-web.mts
 *   pnpm --filter web exec openapi-ts -f openapi-ts.core.config.ts -i openapi-core.snapshot.json
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const envDefaults: Record<string, string> = {
  NETWORK: "Preprod",
  NODE_ENV: "development",
  PORT: "8787",
  DATABASE_URL: "https://example.com/database",
  BETTER_AUTH_SECRET: "test-secret",
  BETTER_AUTH_URL: "https://example.com/auth",
  BETTER_AUTH_RP_ID: "localhost",
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  MICROSOFT_CLIENT_ID: "test-microsoft-client-id",
  MICROSOFT_CLIENT_SECRET: "test-microsoft-client-secret",
  WEB_APP_BASE_URL: "https://example.com",
  POSTMARK_SERVER_ID: "test-postmark-server-id",
  POSTMARK_FROM_EMAIL: "no-reply@example.com",
  PAYMENT_API_URL: "https://example.com/payment",
  PAYMENT_API_KEY: "test-payment-key",
  REGISTRY_API_URL: "https://example.com/registry",
  REGISTRY_API_KEY: "test-registry-key",
  HERMES_ORCH_BASE_URL: "https://example.com/hermes-orchestrator",
  HERMES_ORCH_TOKEN: "test-hermes-orchestrator-token",
  HERMES_INBOX_POLLING_ENABLED: "false",
  ORCHESTRATOR_SERVICE_TOKEN: "test-orchestrator-service-token0",
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
  ABLY_PUBLISH_ONLY_KEY: "local-test",
  JOB_FAILURE_NOTIFICATION_EMAILS: "",
  OPENROUTER_CHAT_API_KEY:
    "sk-or-v1-test-0000000000000000000000000000000000000000",
};

for (const [key, value] of Object.entries(envDefaults)) {
  if (!process.env[key]) process.env[key] = value;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const coreRoot = join(scriptDir, "..");
const webRoot = join(coreRoot, "../web");
const outPath = join(webRoot, "openapi-core.snapshot.json");

const { default: apiV1 } = await import(
  pathToFileURL(join(coreRoot, "src/routes/v1/index.ts")).href
);

const doc = apiV1.getOpenAPI31Document({
  openapi: "3.1.0",
  info: {
    title: "Sokosumi API",
    version: "1.0.0",
    description: "Sokosumi API documentation",
  },
});

writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
