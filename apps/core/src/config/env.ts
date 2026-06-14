import { z } from "@hono/zod-openapi";
import { resolveBetterAuthPublicBaseUrl } from "@sokosumi/utils";
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

  WEB_APP_BASE_URL: z.url().default("http://localhost:3000"),

  // Vercel (optional; Better Auth base URL on Preview)
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
  VERCEL_URL: z
    .string()
    .transform((val: string) =>
      val.startsWith("https://") ? val : `https://${val}`,
    )
    .pipe(z.url())
    .optional(),
  VERCEL_BRANCH_URL: z
    .string()
    .transform((val: string) =>
      val.startsWith("https://") ? val : `https://${val}`,
    )
    .pipe(z.url())
    .optional(),
  VERCEL_GIT_COMMIT_REF: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z
    .string()
    .transform((val: string) =>
      val.startsWith("https://") ? val : `https://${val}`,
    )
    .pipe(z.url())
    .optional(),

  // Better Auth
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_COOKIE_DOMAIN: z.string().optional(),
  BETTER_AUTH_PROFILE_PICTURE_TIMEOUT: z.coerce
    .number()
    .min(1000)
    .default(1000 * 10), // 10 seconds
  BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE: z.coerce
    .number()
    .min(0)
    .default(60 * 5), // 5 minutes
  BETTER_AUTH_RP_ID: z.string().min(1).default("localhost"),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  MICROSOFT_CLIENT_ID: z.string().min(1),
  MICROSOFT_CLIENT_SECRET: z.string().min(1),
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

  // Hermes Orchestrator
  HERMES_ORCH_BASE_URL: z.url(),
  HERMES_ORCH_TOKEN: z.string().min(1),
  HERMES_INBOX_POLLING_ENABLED: z
    .string()
    .default("false")
    .transform((val: string) => val.trim().toLowerCase() === "true"),

  // Composio (managed OAuth + MCP broker for Hermes integrations)
  COMPOSIO_API_KEY: z.string().startsWith("ak_").optional(),
  COMPOSIO_API_BASE_URL: z.url().default("https://backend.composio.dev"),

  // Internal cron authentication
  CRON_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().min(1),

  // Stripe subscription products (per-seat credits live in product metadata)
  STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID: z.string().min(1),
  STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID: z.string().min(1),
  STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID: z.string().min(1),

  // Stripe one-time credit top-up product (invoice.paid credit engine)
  STRIPE_CREDIT_PRODUCT_ID: z.string().min(1),

  // Welcome coupon granted to new user customers (customer.created handler)
  STRIPE_WELCOME_COUPON: z.string().min(1),

  // 100%-off coupon used to issue admin credit grants free of charge
  STRIPE_SUPPORT_COUPON: z.string().min(1),

  // Signing secret for core's own Stripe webhook endpoint (POST /webhooks/stripe)
  STRIPE_WEBHOOK_SECRET: z.string().min(1),

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
 * relatedProjects point to the web app; otherwise uses WEB_APP_BASE_URL.
 */
export function getWebAppBaseUrl(): string {
  const env = getEnv();
  return withRelatedProject({
    projectName:
      env.NETWORK === "Preprod"
        ? "sokosumi-app-preprod"
        : "sokosumi-app-mainnet",
    defaultHost: env.WEB_APP_BASE_URL,
  });
}

/**
 * Public Better Auth base URL (Core deployment). On Vercel Preview, uses the
 * deployment or branch URL when `VERCEL_ENV=preview`. On Vercel Production,
 * prefers `VERCEL_PROJECT_PRODUCTION_URL` when set, then `BETTER_AUTH_URL`.
 */
export function getBetterAuthPublicBaseUrl(): string {
  const env = getEnv();

  return resolveBetterAuthPublicBaseUrl({
    vercelEnv: env.VERCEL_ENV,
    vercelUrl: env.VERCEL_URL,
    vercelBranchUrl: env.VERCEL_BRANCH_URL,
    vercelProductionUrl: env.VERCEL_PROJECT_PRODUCTION_URL,
    fallbackUrl: env.BETTER_AUTH_URL,
  });
}

/**
 * Resolve which Sokosumi env label to pass to the Hermes orchestrator.
 *
 *   - NETWORK === "Mainnet" → "mainnet"
 *   - otherwise (Preprod, also the default when unset) → "preprod"
 *
 * Local dev with default NETWORK=Preprod still reports "preprod" so the
 * orchestrator's sokosumi_sync step exercises the same path as Vercel preprod.
 *
 * The orchestrator uses this to pick the Sokosumi API base + coworker key.
 */
export function resolveSokosumiEnvForOrchestrator(): "preprod" | "mainnet" {
  const env = getEnv();
  return env.NETWORK === "Mainnet" ? "mainnet" : "preprod";
}
