/* eslint-disable no-restricted-properties */
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

/**
 * Specify your environment variables schema here.
 * This way you can ensure the app isn't built with invalid env vars.
 */
const envSecretsSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  MIN_FEE_CREDITS: z.number({ coerce: true }).min(0).default(1),
  FREE_CREDITS_ON_SIGNUP: z.number({ coerce: true }).min(0).default(0),

  SHOW_AGENTS_BY_DEFAULT: z
    .string()
    .default("false")
    .transform((val) => val === "true"),

  // Stripe
  STRIPE_PUBLISHABLE_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_ID: z.string().min(1),

  // Seed
  SEED_DATABASE: z
    .string()
    .default("false")
    .transform((val) => val === "true"),
  SEED_USER_EMAIL: z.string().email().default("dev@sokosumi.com"),
  SEED_USER_PASSWORD: z.string().min(8).default("password"),

  // Authentication
  BETTER_AUTH_SECRET: z.string().min(1),

  // Resend
  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().email(),

  // Social Providers
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  MICROSOFT_CLIENT_ID: z.string().min(1),
  MICROSOFT_CLIENT_SECRET: z.string().min(1),

  // Admin
  ADMIN_KEY: z.string().min(8),

  APPLE_CLIENT_ID: z.string().min(1),
  APPLE_CLIENT_SECRET: z.string().min(1),

  LINKEDIN_CLIENT_ID: z.string().min(1),
  LINKEDIN_CLIENT_SECRET: z.string().min(1),

  PAYMENT_API_KEY: z.string().min(1),
  PAYMENT_API_URL: z
    .string()
    .url()
    .default("https://payment.masumi.network/api/v1"),
  // BetterAuth Settings
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
    .min(3 * 60 * 1000)
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

const envPublicConfigSchema = z.object({
  NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME: z
    .number({ coerce: true })
    .min(0)
    .default(300),
  NEXT_PUBLIC_PASSWORD_MIN_LENGTH: z
    .number({ coerce: true })
    .min(8)
    .max(20)
    .default(8),
  NEXT_PUBLIC_PASSWORD_MAX_LENGTH: z
    .number({ coerce: true })
    .min(10)
    .max(256)
    .default(256),

  NEXT_PUBLIC_MASUMI_URL: z.string().url().default("https://masumi.network"),
  NEXT_PUBLIC_KODOSUMI_URL: z.string().url().default("https://kodosumi.com"),
  NEXT_PUBLIC_SOKOSUMI_URL: z.string().url().default("https://sokosumi.com"),
  NEXT_PUBLIC_NETWORK: z.literal("Preprod").or(z.literal("Mainnet")),
  NEXT_PUBLIC_FEE_PERCENTAGE: z.number({ coerce: true }).min(0).default(5),
  NEXT_PUBLIC_CREDITS_BASE: z.number({ coerce: true }).default(12),
});

let envSecrets: z.infer<typeof envSecretsSchema>;

let envPublicConfig: z.infer<typeof envPublicConfigSchema>;

function validateEnv() {
  const parsedConfig = envPublicConfigSchema.safeParse({
    NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME:
      process.env.NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
    NEXT_PUBLIC_PASSWORD_MIN_LENGTH:
      process.env.NEXT_PUBLIC_PASSWORD_MIN_LENGTH,
    NEXT_PUBLIC_PASSWORD_MAX_LENGTH:
      process.env.NEXT_PUBLIC_PASSWORD_MAX_LENGTH,
    NEXT_PUBLIC_MASUMI_URL: process.env.NEXT_PUBLIC_MASUMI_URL,
    NEXT_PUBLIC_KODOSUMI_URL: process.env.NEXT_PUBLIC_KODOSUMI_URL,
    NEXT_PUBLIC_SOKOSUMI_URL: process.env.NEXT_PUBLIC_SOKOSUMI_URL,
    NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK,
    NEXT_PUBLIC_FEE_PERCENTAGE: process.env.NEXT_PUBLIC_FEE_PERCENTAGE,
    NEXT_PUBLIC_CREDITS_BASE: process.env.NEXT_PUBLIC_CREDITS_BASE,
  });
  if (!parsedConfig.success) {
    console.error(
      "❌ Invalid environment variables:",
      JSON.stringify(parsedConfig.error.format(), null, 2),
    );
    process.exit(1);
  }
  envPublicConfig = parsedConfig.data;

  if (typeof window !== "undefined") {
    //Early return in the client
    return;
  }

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

export function getEnvPublicConfig() {
  if (!envPublicConfig) {
    validateEnv();
  }
  return envPublicConfig;
}
