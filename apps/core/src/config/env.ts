import { z } from "@hono/zod-openapi";
import {
  resolveBetterAuthPublicBaseUrl,
  TURNSTILE_ALWAYS_PASS_SECRET,
} from "@sokosumi/utils";
import { withRelatedProject } from "@vercel/related-projects";
import { v4 as uuidv4 } from "uuid";

/**
 * Environment variables schema for Core API
 * This ensures the app isn't built with invalid env vars.
 */
const baseEnvSchema = z.object({
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

  // Redis / Vercel KV (optional; resumable UI streams, coworker stream locks)
  REDIS_URL: z.string().optional(),
  KV_URL: z.string().optional(),

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
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
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

  /**
   * Credits under which a wallet is told it is running low (SOK-932).
   *
   * The same number web draws its low-credit label at
   * (`NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD`), so the feed and the sidebar
   * agree about what low means. Zero switches the notification off.
   */
  LOW_CREDITS_THRESHOLD: z.coerce.number().min(0).default(100),

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
  /** Optional GitHub token for skill installs (raises the anonymous API rate limit). */
  GITHUB_TOKEN: z.string().min(1).optional(),
  /**
   * Judge model for lab runs and per-turn quality scores (AI Gateway id).
   *
   * The judge grades every settled turn, so its mistakes become the quality
   * signal. Measured against turns whose outcome was checked by hand, Haiku
   * and Sonnet score the same once the transcript is complete — the errors
   * were missing evidence, not model strength. Haiku stays the default
   * because nothing measured says the more expensive model judges better,
   * and this runs on every turn. `soko-bot:judge-eval` re-grades with any
   * model, so a case for changing it can be made with numbers.
   */
  SOKO_BOT_JUDGE_MODEL: z.string().min(1).default("anthropic/claude-haiku-4.5"),
  /** Score every completed turn with the judge model. */
  SOKO_BOT_TURN_JUDGE_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  /** fal.ai key for Soko Bot avatar generation; the pool cannot top up without it. */
  FAL_KEY: z.string().min(1).optional(),
  PROJECT_MEMORY_MODEL: z
    .string()
    .startsWith("mistral/")
    .default("mistral/mistral-medium-3.5"),

  // First-party Soko Bot control plane and Eve runtime.
  SOKO_BOT_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value.trim().toLowerCase() === "true"),

  // Temporary overlay (ADR 0010): org-first membership also gets a personal
  // workspace. Default false is ADR 0005 (personal optional).
  REQUIRE_PERSONAL_WORKSPACE: z
    .string()
    .default("false")
    .transform((val: string) => val.trim().toLowerCase() === "true"),

  /** Platform-wide kill switch for everything Soko Bots start on their own. */
  SOKO_BOT_PROACTIVE_PAUSED: z
    .string()
    .default("false")
    .transform((value) => value.trim().toLowerCase() === "true"),
  /** Composio brokers OAuth for Soko Bot integrations (Gmail, Outlook, …). */
  COMPOSIO_API_KEY: z.string().min(1).optional(),
  COMPOSIO_API_BASE_URL: z.url().optional(),
  COMPOSIO_X_AUTH_CONFIG_ID: z.string().min(1).optional(),
  SOKO_BOT_RUNTIME_ADAPTER: z
    .enum(["in-memory", "in-process"])
    .default("in-process"),
  SOKO_BOT_CLASSIFIER_MODE: z
    .enum(["deterministic", "model"])
    .default("deterministic"),
  SOKO_BOT_CREDITS_PER_USD: z.coerce.number().positive().default(100),
  SOKO_BOT_MIN_TURN_CREDITS: z.coerce.number().positive().default(0.1),
  /** Most credits one hire may commit on a turn no owner asked for. */
  SOKO_BOT_UNATTENDED_MAX_HIRE_CREDITS: z.coerce
    .number()
    .positive()
    .default(50),

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
  /**
   * Temporary adapter for the removed per-Task schedule routes.
   * Remove after 2026-09-29. Default on; set 0/false/off to return 410 again.
   */
  LEGACY_TASK_SCHEDULE_SHIM: z
    .string()
    .default("1")
    .transform((value) => {
      const normalized = value.trim().toLowerCase();
      return (
        normalized !== "0" && normalized !== "false" && normalized !== "off"
      );
    }),

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

function isDeployedEnvironment(value: z.infer<typeof baseEnvSchema>): boolean {
  return (
    value.NODE_ENV === "production" ||
    value.VERCEL_ENV === "production" ||
    value.VERCEL_ENV === "preview"
  );
}

/**
 * A deployed environment serving real users, as opposed to a preview.
 *
 * Previews are throwaway and are the one deployment where Cloudflare's test
 * keys are a reasonable choice — they let an agent drive the sign-in form
 * without answering a human check. Production has no such excuse.
 *
 * On Vercel, `NODE_ENV` is "production" for every deployment, previews
 * included, so it cannot tell the two apart and `VERCEL_ENV` is the only
 * honest signal. Reading both with `||` made every preview a production one,
 * which killed the very case the paragraph above describes: a preview holding
 * the always-passes secret exited at boot, so every route answered
 * FUNCTION_INVOCATION_FAILED instead of warning.
 *
 * Off Vercel there is no `VERCEL_ENV`, and `NODE_ENV` is the only signal
 * there is.
 */
function isProductionEnvironment(
  value: z.infer<typeof baseEnvSchema>,
): boolean {
  if (value.VERCEL_ENV) {
    return value.VERCEL_ENV === "production";
  }
  return value.NODE_ENV === "production";
}

const envSchema = baseEnvSchema.superRefine((value, context) => {
  if (!value.SOKO_BOT_ENABLED) return;
  // The agent runs inside Core, so enabling it needs no runtime deployment,
  // signing key, or allowlist — only a real adapter in a deployed environment.
  if (!isDeployedEnvironment(value)) return;
  if (value.SOKO_BOT_RUNTIME_ADAPTER !== "in-process") {
    context.addIssue({
      code: "custom",
      path: ["SOKO_BOT_RUNTIME_ADAPTER"],
      message:
        "SOKO_BOT_RUNTIME_ADAPTER must be in-process when Soko Bot is enabled in a deployed environment",
    });
  }
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

  if (!result.data.TURNSTILE_SECRET_KEY && isDeployedEnvironment(result.data)) {
    console.warn(
      "TURNSTILE_SECRET_KEY is unset in a deployed environment; Turnstile captcha verification is disabled and auth email endpoints are unprotected from spam",
    );
  }

  // Worse than unset, and quieter about it: siteverify succeeds for ANY token,
  // forged ones included, so the endpoints look protected while they are not.
  // Every local checkout now carries this secret, which is exactly how it ends
  // up pasted into a deployment.
  //
  // Production refuses to boot rather than warn. An unset secret is honestly
  // off and its warning is proportionate; this one serves a captcha that
  // passes everything, and a warning in a build log is not read by anyone.
  // Previews keep the warning: a test key is a defensible choice there, since
  // it lets an agent drive sign-in without answering a human check.
  if (result.data.TURNSTILE_SECRET_KEY === TURNSTILE_ALWAYS_PASS_SECRET) {
    if (isProductionEnvironment(result.data)) {
      console.error(
        "❌ TURNSTILE_SECRET_KEY is Cloudflare's published always-passes testing secret. In production this accepts every captcha token, including forged ones, while the auth endpoints appear protected. Set a real secret from the Turnstile dashboard.",
      );
      process.exit(1);
    }

    if (isDeployedEnvironment(result.data)) {
      console.warn(
        "TURNSTILE_SECRET_KEY is Cloudflare's published always-passes testing secret in a preview environment; captcha verification accepts every token, including forged ones. Intended only for driving sign-in without a human check.",
      );
    }
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
 * Temporary. Remove after 2026-09-29. Reads `process.env` so tests can stub
 * the flag without resetting the cached env config.
 */
export function isLegacyTaskScheduleShimEnabled(): boolean {
  const raw = process.env.LEGACY_TASK_SCHEDULE_SHIM ?? "1";
  const normalized = raw.trim().toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "off";
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
