import { z } from "@hono/zod-openapi";

/**
 * Environment variables schema for Core API
 * This ensures the app isn't built with invalid env vars.
 */
const envSchema = z.object({
  // Environment
  NODE_ENV: z
    .enum(["development", "staging", "production"])
    .default("development"),

  // Server
  PORT: z.coerce.number().min(1).max(65535).default(8787),

  // Database
  DATABASE_URL: z.url(),

  // Better Auth
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_TRUSTED_ORIGIN: z.url(),

  // Social Providers
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  MICROSOFT_CLIENT_ID: z.string().min(1),
  MICROSOFT_CLIENT_SECRET: z.string().min(1),

  // Sentry
  SENTRY_DSN: z.url().optional(),
  SENTRY_ENVIRONMENT: z
    .enum(["development", "staging", "production"])
    .optional(),

  // Postmark
  POSTMARK_SERVER_ID: z.string().min(1),
  POSTMARK_FROM_EMAIL: z.email(),

  // Stripe
  STRIPE_SECRET_KEY: z.string().min(1),

  // Analytics Webhooks
  WEBHOOK_USER_CREATED: z.url().optional(),
  WEBHOOK_USER_UPDATED: z.url().optional(),
  WEBHOOK_ACCOUNT_CREATED: z.url().optional(),

  // Vercel Blob Storage
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

let envConfig: EnvConfig | null = null;

export function validateEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error(
      "❌ Invalid environment variables:",
      JSON.stringify(result.error.format(), null, 2),
    );
    process.exit(1);
  }

  return result.data;
}

export function getEnv(): EnvConfig {
  if (!envConfig) {
    envConfig = validateEnv();
  }
  return envConfig;
}
