import "server-only";

/* eslint-disable no-restricted-properties */
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

  NETWORK: z.enum(["Mainnet", "Preprod"]).default("Preprod"),

  // Database
  DATABASE_URL: z.url(),

  CORE_APP_BASE_URL: z.url().default("http://localhost:8787"),

  // Cron auth — shared bearer for /api/internal/* cron routes.
  CRON_SECRET: z.string().min(1).optional(),

  CHROMIUM_EXECUTABLE_URL: z
    .url()
    .default(
      "https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar",
    ),

  // Usercentrics
  USER_CENTRICS_DATA_SETTINGS_ID: z.string().min(1).optional(),
  DRAFT_USER_CENTRICS: z
    .string()
    .transform((val: string) => val.trim().toLowerCase() === "true")
    .default(false),

  SHOW_AGENTS_BY_DEFAULT: z
    .string()
    .transform((val: string) => val.trim().toLowerCase() === "true")
    .default(false),

  MAINTENANCE_MODE: z
    .string()
    .transform((val: string) => val.trim().toLowerCase() === "true")
    .default(false),

  // Stripe
  STRIPE_PUBLISHABLE_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_CREDIT_PRODUCT_ID: z.string().min(1),
  STRIPE_ONBOARD_PERSONAL_COUPON: z.string().min(1),
  STRIPE_ONBOARD_ORGANIZATION_COUPON: z.string().min(1),
  STRIPE_WELCOME_COUPON: z.string().min(1),
  // 100%-off coupon used to issue admin credit grants free of charge.
  STRIPE_SUPPORT_COUPON: z.string().min(1),
  STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID: z.string().min(1),
  STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID: z.string().min(1),
  STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID: z.string().min(1),

  // OpenRouter
  OPENROUTER_DEFAULT_API_KEY: z.string().startsWith("sk-or-").optional(),
  OPENROUTER_CHAT_API_KEY: z.string().startsWith("sk-or-").optional(),

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
  VERCEL_IMAGES_UPLOAD_DIR: z.string().default("images"),

  PAYMENT_API_KEY: z.string().min(1),
  PAYMENT_API_URL: z.url().default("https://payment.masumi.network/api/v1"),
  MASUMI_DESIGN_MD_API_KEY: z.string().min(1).optional(),
  MASUMI_DESIGN_MD_API_URL: z
    .url()
    .default("https://www.masumi.network/api/v1"),

  // Social Secrets
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  MICROSOFT_CLIENT_ID: z.string().min(1),
  MICROSOFT_CLIENT_SECRET: z.string().min(1),

  // Better Auth Settings
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  BETTER_AUTH_COOKIE_DOMAIN: z.string().optional(),
  BETTER_AUTH_RP_ID: z.string().min(1).default("localhost"),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE: z.coerce
    .number()
    .min(0)
    .default(60 * 5), // 5 minutes
  BETTER_AUTH_ORG_INVITATION_LIMIT: z.coerce.number().min(0).default(100),
  BETTER_AUTH_ORG_LIMIT: z.coerce.number().min(0).default(100),
  BETTER_AUTH_ORG_INVITATION_EXPIRES_IN: z.coerce
    .number()
    .min(172800)
    .default(604800), // 7 days in seconds
  BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN: z.coerce
    .number()
    .min(86400)
    .default(172800), // 2 days in seconds
  REGISTRY_API_URL: z.url().default("https://registry.masumi.network/api/v1"),
  REGISTRY_API_KEY: z.string().min(1),
  BETTER_AUTH_PROFILE_PICTURE_TIMEOUT: z.coerce.number().default(1000 * 10), // 10 seconds

  // ably keys
  ABLY_SUBSCRIBE_ONLY_KEY: z.string().min(1),
  ABLY_PUBLISH_ONLY_KEY: z.string().min(1),

  // analytics webhooks
  AGENT_HIRED_WEBHOOK: z.url().optional(),
  USER_CREATED_WEBHOOK: z.url().optional(),
  USER_UPDATED_WEBHOOK: z.url().optional(),
  ACCOUNT_CREATED_WEBHOOK: z.url().optional(),
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
