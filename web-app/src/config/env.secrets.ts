import "server-only";

/* eslint-disable no-restricted-properties */
import { v4 as uuidv4 } from "uuid";
import * as z from "zod";

/**
 * Specify your environment variables schema here.
 * This way you can ensure the app isn't built with invalid env vars.
 */
const envSecretsSchema = z.object({
  // Environment
  NODE_ENV: z
    .enum(["development", "staging", "production"])
    .default("development"),

  // Database
  DATABASE_URL: z.url(),
  MIN_FEE_CREDITS: z.coerce.number().min(0).default(1),
  ALLOWED_EMAIL_DOMAINS: z
    .string()
    .transform((val: string) => (val.trim() === "" ? [] : val.split(",")))
    .default([]),

  // Usercentrics
  USER_CENTRICS_DATA_SETTINGS_ID: z.string().min(1).optional(),
  DRAFT_USER_CENTRICS: z
    .string()
    .transform((val: string) => val.trim().toLowerCase() === "true")
    .default(false),

  // Usersnap
  USERSNAP_SPACE_API_KEY: z.string().min(1).optional(),

  SHOW_AGENTS_BY_DEFAULT: z
    .string()
    .transform((val: string) => val.trim().toLowerCase() === "true")
    .default(false),

  // Stripe
  STRIPE_PUBLISHABLE_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRODUCT_ID: z.string().min(1),
  STRIPE_WELCOME_COUPONS: z
    .string()
    .transform((val: string) => (val.trim() === "" ? [] : val.split(",")))
    .default([]),
  STRIPE_ONBOARD_PERSONAL_COUPON: z.string().min(1),
  STRIPE_ONBOARD_ORGANIZATION_COUPON: z.string().min(1),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1).startsWith("sk-"),

  // Seed
  SEED_DATABASE: z
    .string()
    .transform((val: string) => val === "true")
    .default(false),
  SEED_USER_EMAIL: z.email().default("dev@sokosumi.com"),
  SEED_USER_PASSWORD: z.string().min(8).default("password"),

  // Postmark
  POSTMARK_SERVER_ID: z.string().min(1),
  POSTMARK_FROM_EMAIL: z.email(),

  // Vercel
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

  CRON_SECRET: z.string().optional(),

  PAYMENT_API_KEY: z.string().min(1),
  PAYMENT_API_URL: z.url().default("https://payment.masumi.network/api/v1"),

  // Social Secrets
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  MICROSOFT_CLIENT_ID: z.string().min(1),
  MICROSOFT_CLIENT_SECRET: z.string().min(1),

  // Better Auth Settings
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_TRUSTED_ORIGIN: z.url().default("http://localhost:3000"),
  BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE: z.coerce
    .number()
    .min(0)
    .default(60 * 5), // 5 minutes
  BETTER_AUTH_ORG_INVITATION_LIMIT: z.coerce.number().min(0).default(100),
  BETTER_AUTH_ORG_LIMIT: z.coerce.number().min(0).default(100),
  BETTER_AUTH_ORG_INVITATION_EXPIRES_IN: z.coerce.number().min(24).default(168), // 7 days
  BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN: z.coerce
    .number()
    .min(3600)
    .default(86400), // 1 day
  LOCK_TIMEOUT: z.coerce
    .number()
    .min(1 * 60 * 1000)
    .default(2 * 60 * 1000), // 2 minutes
  LOCK_TIMEOUT_BUFFER: z.coerce
    .number()
    .min(1000)
    .default(1000 * 25), // 25 seconds
  INSTANCE_ID: z.string().min(1).default(uuidv4()),
  REGISTRY_API_URL: z.url().default("https://registry.masumi.network/api/v1"),
  REGISTRY_API_KEY: z.string().min(1),
  BLACKLISTED_AGENT_HOSTNAMES: z
    .string()
    .transform((val: string) => (val.trim() === "" ? [] : val.split(",")))
    .default([]),

  // ably keys
  ABLY_AGENT_JOBS_SUBSCRIBE_ONLY_KEY: z.string().min(1),
  ABLY_AGENT_JOBS_PUBLISH_ONLY_KEY: z.string().min(1),

  // after agent hired webhook
  AFTER_AGENT_HIRED_WEB_HOOK: z.url().optional(),

  // marketing opt in webhook
  MARKETING_OPT_IN_WEB_HOOK: z.url().optional(),
});

let envSecrets: z.infer<typeof envSecretsSchema>;

function validateEnv() {
  const parsedSecrets = envSecretsSchema.safeParse(process.env);

  if (!parsedSecrets.success) {
    console.error(
      "❌ Invalid environment secrets:",
      JSON.stringify(parsedSecrets.error.format(), null, 2),
    );
    process.exit(1);
  }
  envSecrets = parsedSecrets.data;
}

export function getEnvSecrets() {
  if (!envSecrets) {
    if (typeof window !== "undefined") {
      console.warn("Calling secret from client");
    }
    validateEnv();
  }
  return envSecrets;
}
