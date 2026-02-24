const envDefaults: Record<string, string> = {
  NETWORK: "Preprod",
  NODE_ENV: "development",
  PORT: "8787",
  DATABASE_URL: "https://example.com/database",
  BETTER_AUTH_SECRET: "test-secret",
  BETTER_AUTH_URL: "https://example.com/auth",
  BETTER_AUTH_TRUSTED_ORIGIN: "https://example.com",
  PAYMENT_API_URL: "https://example.com/payment",
  PAYMENT_API_KEY: "test-payment-key",
  REGISTRY_API_URL: "https://example.com/registry",
  REGISTRY_API_KEY: "test-registry-key",
  CRON_SECRET: "test-cron-secret",
  LOCK_TIMEOUT: "900000",
  INSTANCE_ID: "test-instance-id",
  SHOW_AGENTS_BY_DEFAULT: "true",
  ABLY_PUBLISH_ONLY_KEY: "local-test",
};

for (const [key, value] of Object.entries(envDefaults)) {
  process.env[key] = value;
}
