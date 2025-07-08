import "server-only";

/* eslint-disable no-restricted-properties */
import { v4 as uuidv4 } from "uuid";
import z from "zod";

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
  DATABASE_URL: z.string().url(),
  MIN_FEE_CREDITS: z.number({ coerce: true }).min(0).default(1),
  ALLOWED_EMAIL_DOMAINS: z
    .string()
    .default("")
    .transform((val) => (val.trim() === "" ? [] : val.split(",")))
    .pipe(z.array(z.string())),

  SHOW_AGENTS_BY_DEFAULT: z
    .string()
    .default("false")
    .transform((val) => val === "true"),

  // Plausible
  PLAUSIBLE_DOMAIN: z.string().default("sokosumi.com"),

  // Stripe
  STRIPE_PUBLISHABLE_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRODUCT_ID: z.string().min(1),
  STRIPE_WELCOME_COUPON: z.string().min(1).optional(),

  // Seed
  SEED_DATABASE: z
    .string()
    .default("false")
    .transform((val) => val === "true"),
  SEED_USER_EMAIL: z.string().email().default("dev@sokosumi.com"),
  SEED_USER_PASSWORD: z.string().min(8).default("password"),

  // Resend
  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().email(),

  // Admin
  ADMIN_KEY: z.string().min(8),

  PAYMENT_API_KEY: z.string().min(1),
  PAYMENT_API_URL: z
    .string()
    .url()
    .default("https://payment.masumi.network/api/v1"),

  // BetterAuth Settings
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_TRUSTED_ORIGINS: z
    .string()
    .transform((val) => val.split(","))
    .pipe(z.array(z.string()))
    .default(""),
  BETTER_AUTH_SESSION_EXPIRES_IN: z
    .number({ coerce: true })
    .min(1)
    .default(60 * 60 * 24 * 7), // 7 days
  BETTER_AUTH_SESSION_UPDATE_AGE: z
    .number({ coerce: true })
    .min(1)
    .default(60 * 60 * 24), // 1 day
  BETTER_AUTH_SESSION_FRESH_AGE: z
    .number({ coerce: true })
    .min(1)
    .default(60 * 5), // 5 minutes
  BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE: z
    .number({ coerce: true })
    .min(0)
    .default(60 * 5), // 5 minutes
  LOCK_TIMEOUT: z
    .number({ coerce: true })
    .min(1 * 60 * 1000)
    .default(10 * 60 * 1000), // 10 minutes
  LOCK_TIMEOUT_BUFFER: z
    .number({ coerce: true })
    .min(1000)
    .default(1000 * 25), // 25 seconds
  INSTANCE_ID: z.string().min(1).default(uuidv4()),
  REGISTRY_API_URL: z
    .string()
    .url()
    .default("https://registry.masumi.network/api/v1"),
  REGISTRY_API_KEY: z.string().min(1),
  BLACKLISTED_AGENT_HOSTNAMES: z
    .string()
    .transform((val) => val.split(","))
    .pipe(z.array(z.string()))
    .default(""),
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
