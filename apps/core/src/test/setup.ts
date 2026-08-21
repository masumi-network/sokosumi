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
  RESEND_API_KEY: "test-resend-api-key",
  RESEND_FROM_EMAIL: "no-reply@example.com",
  PAYMENT_API_URL: "https://example.com/payment",
  PAYMENT_API_KEY: "test-payment-key",
  REGISTRY_API_URL: "https://example.com/registry",
  REGISTRY_API_KEY: "test-registry-key",
  HERMES_ORCH_BASE_URL: "https://example.com/hermes-orchestrator",
  HERMES_ORCH_TOKEN: "test-hermes-orchestrator-token",
  HERMES_INBOX_POLLING_ENABLED: "false",
  REQUIRE_PERSONAL_WORKSPACE: "false",
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
