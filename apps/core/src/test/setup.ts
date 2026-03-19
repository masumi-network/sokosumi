const envDefaults: Record<string, string> = {
  NETWORK: "Preprod",
  NODE_ENV: "development",
  PORT: "8787",
  DATABASE_URL: "https://example.com/database",
  BETTER_AUTH_SECRET: "test-secret",
  BETTER_AUTH_URL: "https://example.com",
  WEB_APP_BASE_URL: "https://example.com",

  POSTMARK_SERVER_ID: "test-postmark-server-id",
  POSTMARK_FROM_EMAIL: "no-reply@example.com",
  PAYMENT_API_URL: "https://example.com/payment",
  PAYMENT_API_KEY: "test-payment-key",
  REGISTRY_API_URL: "https://example.com/registry",
  REGISTRY_API_KEY: "test-registry-key",
  CRON_SECRET: "test-cron-secret",
  STRIPE_SECRET_KEY: "sk_test_example",
  LOCK_TIMEOUT: "900000",
  LOCK_TIMEOUT_BUFFER: "25000",
  INSTANCE_ID: "test-instance-id",
  SHOW_AGENTS_BY_DEFAULT: "true",
  MAINTENANCE_MODE: "false",
  ABLY_PUBLISH_ONLY_KEY: "local-test",
  JOB_FAILURE_NOTIFICATION_EMAILS: "",
};

for (const [key, value] of Object.entries(envDefaults)) {
  process.env[key] = value;
}
