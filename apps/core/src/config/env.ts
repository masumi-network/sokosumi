import { z } from "@hono/zod-openapi";
import { withRelatedProject } from "@vercel/related-projects";
import { v4 as uuidv4 } from "uuid";

/**
 * Environment variables schema for Core API
 * This ensures the app isn't built with invalid env vars.
 */
const envSchema = z.object({
  NETWORK: z.enum(["Preprod", "Mainnet"]).default("Preprod"),

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
  BETTER_AUTH_TRUSTED_ORIGIN: z
    .url()
    .default("http://localhost:3000")
    .describe(
      "Web app origin; on Vercel overridden by related web project URL",
    ),
  POSTMARK_SERVER_ID: z.string().min(1),
  POSTMARK_FROM_EMAIL: z.email(),

  // Sentry
  SENTRY_DSN: z.url().optional(),
  SENTRY_ENVIRONMENT: z
    .enum(["development", "staging", "production"])
    .optional(),

  // Payment
  PAYMENT_API_URL: z.url(),
  PAYMENT_API_KEY: z.string().min(1),

  // Registry
  REGISTRY_API_URL: z.url(),
  REGISTRY_API_KEY: z.string().min(1),

  // OpenRouter
  OPENROUTER_DEFAULT_API_KEY: z.string().startsWith("sk-or-").optional(),
  OPENROUTER_CHAT_API_KEY: z.string().startsWith("sk-or-").optional(),

  // Internal cron authentication
  CRON_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().min(1),

  // Sync lock configuration
  LOCK_TIMEOUT: z.coerce
    .number()
    .min(1 * 60 * 1000)
    .default(5 * 60 * 1000),
  LOCK_TIMEOUT_BUFFER: z.coerce
    .number()
    .min(1000)
    .default(1000 * 25),
  INSTANCE_ID: z.string().min(1).default(uuidv4()),
  SHOW_AGENTS_BY_DEFAULT: z
    .string()
    .default("false")
    .transform((val: string) => val.trim().toLowerCase() === "true"),
  MAINTENANCE_MODE: z
    .string()
    .default("false")
    .transform((val: string) => val.trim().toLowerCase() === "true"),

  // Vercel Blob Storage
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),

  // Ably
  ABLY_PUBLISH_ONLY_KEY: z.string().min(1),

  // Optional outbound webhooks
  WEBHOOK_USER_CREATED: z.url().optional(),
  WEBHOOK_USER_UPDATED: z.url().optional(),
  WEBHOOK_ACCOUNT_CREATED: z.url().optional(),

  // Job failure notifications
  JOB_FAILURE_NOTIFICATION_EMAILS: z
    .string()
    .default("")
    .transform((value: string) =>
      value.trim() === "" ? [] : value.split(",").map((email) => email.trim()),
    )
    .pipe(z.array(z.email())),
  JOB_FAILURE_WEBHOOK_URL: z.url().optional(),
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

/**
 * Web app base URL (used for Better Auth trusted origin, redirects, and links).
 * On Vercel, uses the related web project deployment URL when core's
 * relatedProjects point to the web app; otherwise uses BETTER_AUTH_TRUSTED_ORIGIN.
 */
export function getWebAppBaseUrl(): string {
  const env = getEnv();
  return withRelatedProject({
    projectName:
      env.NETWORK === "Preprod"
        ? "sokosumi-web-preprod"
        : "sokosumi-web-mainnet",
    defaultHost: env.BETTER_AUTH_TRUSTED_ORIGIN,
  });
}
