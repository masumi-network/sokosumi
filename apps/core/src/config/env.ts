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
  HOST: z.string().min(1).optional(),

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
  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.email().default("noreply@sokosumi.com"),

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

  // Project memory (Vercel AI Gateway, Mistral EU provider only)
  AI_GATEWAY_API_KEY: z.string().min(1).optional(),
  PROJECT_MEMORY_MODEL: z
    .string()
    .startsWith("mistral/")
    .default("mistral/mistral-medium-3.5"),

  // Hermes Orchestrator (Core → Hermes outbound)
  HERMES_ORCH_BASE_URL: z.url(),
  HERMES_ORCH_TOKEN: z.string().min(1),
  HERMES_INBOX_POLLING_ENABLED: z
    .string()
    .default("false")
    .transform((val: string) => val.trim().toLowerCase() === "true"),

  // Hermes → Core service auth (shared secret; not a per-user DB key).
  // Min 32 matches `openssl rand -hex 16` (16 bytes → 32 hex chars).
  // Must not use coworker_/orch_ prefixes: bearer middleware routes those
  // to coworker API-key verification and never reaches the orch compare.
  ORCHESTRATOR_SERVICE_TOKEN: z
    .string()
    .min(32)
    .refine(
      (v) => !v.startsWith("coworker_") && !v.startsWith("orch_"),
      "must not start with coworker_ or orch_ (reserved bearer prefixes)",
    ),

  // skills.sh marketplace (browse/search/audit for Hermes skills). The OIDC
  // token is injected by the Vercel runtime; optional so local/non-Vercel
  // envs degrade to an empty catalog instead of failing to boot.
  SKILLS_SH_BASE_URL: z.url().default("https://skills.sh/api/v1"),
  VERCEL_OIDC_TOKEN: z.string().min(1).optional(),

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

  // Credits granted to new users on signup (direct DB bucket, not Stripe)
  SIGNUP_BONUS_CREDITS: z.coerce.number().int().positive().default(3000),
  SIGNUP_BONUS_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Signing secret for Stripe webhooks (POST /auth/stripe/webhook). Stripe Dashboard
  // should send all events here; billing events are handled from auth onEvent.
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
  /**
   * Ed25519 public key (PEM) used to verify Blob `onUploadCompleted` webhooks
   * for presigned client uploads. Required for task-file auto-registration.
   * @see https://vercel.com/docs/vercel-blob/vercel-signed-urls
   */
  BLOB_WEBHOOK_PUBLIC_KEY: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    }),
  /**
   * Optional public base URL for Blob completion callbacks (e.g. ngrok in
   * local dev). When unset, Core uses {@link getBetterAuthPublicBaseUrl}.
   */
  VERCEL_BLOB_CALLBACK_URL: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    })
    .pipe(z.url().optional()),

  // Ably
  ABLY_PUBLISH_ONLY_KEY: z.string().min(1),
  /** Subscribe-only key used to mint client TokenRequests (SOK-741). */
  ABLY_SUBSCRIBE_ONLY_KEY: z.string().min(1),

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

const PREVIEW_DOMAIN = "preview.sokosumi.com";

function getWebRelatedProjectName(network: EnvConfig["NETWORK"]): string {
  return network === "Preprod"
    ? "sokosumi-app-preprod"
    : "sokosumi-app-mainnet";
}

function sanitizePreviewBranchSegment(value: string): string | undefined {
  let normalized = "";
  let previousWasSeparator = false;

  for (const character of value.toLowerCase()) {
    const isAlphaNumeric =
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9");

    if (isAlphaNumeric) {
      normalized += character;
      previousWasSeparator = false;
      continue;
    }

    if (normalized === "" || previousWasSeparator) {
      continue;
    }

    normalized += "-";
    previousWasSeparator = true;
  }

  if (normalized.endsWith("-")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized || undefined;
}

export interface ResolveWebRelatedProjectFallbackHostParams {
  configuredWebAppBaseUrl: string;
  network: EnvConfig["NETWORK"];
  vercelEnv?: string;
  vercelGitCommitRef?: string;
}

export function resolveWebRelatedProjectFallbackHost(
  params: ResolveWebRelatedProjectFallbackHostParams,
): string {
  if (params.vercelEnv === "preview") {
    const branchSegment = sanitizePreviewBranchSegment(
      params.vercelGitCommitRef ?? "",
    );

    if (branchSegment) {
      return `https://${getWebRelatedProjectName(
        params.network,
      )}-git-${branchSegment}.${PREVIEW_DOMAIN}`;
    }
  }

  return params.configuredWebAppBaseUrl;
}

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
    projectName: getWebRelatedProjectName(env.NETWORK),
    defaultHost: resolveWebRelatedProjectFallbackHost({
      configuredWebAppBaseUrl: env.WEB_APP_BASE_URL,
      network: env.NETWORK,
      vercelEnv: env.VERCEL_ENV,
      vercelGitCommitRef: env.VERCEL_GIT_COMMIT_REF,
    }),
  });
}

/**
 * Public Better Auth base URL (Core deployment). On Vercel Preview, prefers
 * `VERCEL_BRANCH_URL` (stable branch alias; with Preview Deployment Suffix
 * this is already on `*.preview.sokosumi.com`) over `VERCEL_URL`. When only
 * one of those is on a `*.sokosumi.com` host, that one wins regardless of
 * order. Falls back to `BETTER_AUTH_URL`. On Vercel Production, prefers
 * `VERCEL_PROJECT_PRODUCTION_URL` when set, then `BETTER_AUTH_URL`.
 */
export function getBetterAuthPublicBaseUrl(): string {
  const env = getEnv();

  if (
    env.VERCEL_ENV === "preview" &&
    !env.VERCEL_BRANCH_URL &&
    !env.VERCEL_URL
  ) {
    console.warn(
      "Better Auth preview base URL falling back to BETTER_AUTH_URL; VERCEL_BRANCH_URL and VERCEL_URL are unset (magic-link emails may point at the wrong host)",
    );
  }

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
