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

  // Social Providers
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  MICROSOFT_CLIENT_ID: z.string().min(1),
  MICROSOFT_CLIENT_SECRET: z.string().min(1),

  // Additional trusted origins (comma-separated)
  TRUSTED_ORIGINS: z
    .string()
    .transform((val) =>
      val
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .optional(),

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
});

export type EnvConfig = z.infer<typeof envSchema>;

let envConfig: EnvConfig | null = null;

function validateEnv(): EnvConfig {
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
