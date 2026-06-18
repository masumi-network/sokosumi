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

  CORE_APP_BASE_URL: z.url().default("http://localhost:8787"),

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

  MAINTENANCE_MODE: z
    .string()
    .transform((val: string) => val.trim().toLowerCase() === "true")
    .default(false),

  // Stripe
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_CREDIT_PRODUCT_ID: z.string().min(1),
  STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID: z.string().min(1),
  STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID: z.string().min(1),
  STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID: z.string().min(1),

  // OpenRouter
  OPENROUTER_DEFAULT_API_KEY: z.string().startsWith("sk-or-").optional(),

  // Postmark
  POSTMARK_SERVER_ID: z.string().min(1),

  // Vercel
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
  VERCEL_URL: z
    .string()
    .transform((val: string) =>
      val.startsWith("https://") ? val : `https://${val}`,
    )
    .pipe(z.url())
    .optional(),
  VERCEL_GIT_COMMIT_REF: z.string().optional(),
  VERCEL_IMAGES_UPLOAD_DIR: z.string().default("images"),

  PAYMENT_API_KEY: z.string().min(1),
  PAYMENT_API_URL: z.url().default("https://payment.masumi.network/api/v1"),
  MASUMI_DESIGN_MD_API_KEY: z.string().min(1).optional(),
  MASUMI_DESIGN_MD_API_URL: z
    .url()
    .default("https://www.masumi.network/api/v1"),

  // Shared signing secret (must match Core BETTER_AUTH_SECRET).
  APP_SIGNING_SECRET: z.string().min(1),

  // Max pending invitations per organization (optional; default 100).
  ORG_INVITATION_LIMIT: z.coerce.number().min(0).default(100),

  // ably keys
  ABLY_SUBSCRIBE_ONLY_KEY: z.string().min(1),
  ABLY_PUBLISH_ONLY_KEY: z.string().min(1),

  // analytics webhooks
  AGENT_HIRED_WEBHOOK: z.url().optional(),
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
