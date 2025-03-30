/* eslint-disable no-restricted-properties */
import { z } from "zod";

/**
 * Specify your environment variables schema here.
 * This way you can ensure the app isn't built with invalid env vars.
 */
const envSchemaSecrets = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  SEED_DUMMY_AGENTS: z
    .string()
    .default("false")
    .transform((val) => val === "true"),

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

  // BetterAuth Settings
  BETTER_AUTH_SESSION_EXPIRES_IN: z
    .number()
    .min(1)
    .default(60 * 60 * 24 * 7), // 7 days
  BETTER_AUTH_SESSION_UPDATE_AGE: z
    .number()
    .min(1)
    .default(60 * 60 * 24), // 1 day
  BETTER_AUTH_SESSION_FRESH_AGE: z
    .number()
    .min(1)
    .default(60 * 5), // 5 minutes
  BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE: z
    .number()
    .min(0)
    .default(60 * 5), // 5 minutes
  LOCK_TIMEOUT: z
    .number()
    .min(3 * 60 * 1000)
    .default(10 * 60 * 1000), // 10 minutes
  INSTANCE_ID: z.string().min(1).default(crypto.randomUUID()),
  REGISTRY_API_URL: z
    .string()
    .url()
    .default("https://registry.masumi.network/api/v1"),
  REGISTRY_API_KEY: z.string().min(1),
});

const envSchemaConfig = z.object({
  NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME: z.number().min(0).default(300),

  NEXT_PUBLIC_PASSWORD_MIN_LENGTH: z.number().min(8).max(20).default(8),
  NEXT_PUBLIC_PASSWORD_MAX_LENGTH: z.number().min(10).max(256).default(256),

  NEXT_PUBLIC_MASUMI_URL: z.string().url().default("https://masumi.network"),
  NEXT_PUBLIC_KODOSUMI_URL: z.string().url().default("https://kodosumi.com"),
  NEXT_PUBLIC_SOKOSUMI_URL: z.string().url().default("https://sokosumi.com"),
  NEXT_PUBLIC_NETWORK: z.literal("Preprod").or(z.literal("Mainnet")),
});

let envSecrets: z.infer<typeof envSchemaSecrets>;

let envPublicConfig: z.infer<typeof envSchemaConfig>;

function validateEnv() {
  const parsedConfig = envSchemaConfig.safeParse({
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

  const parsedSecrets = envSchemaSecrets.safeParse(process.env);

  if (!parsedSecrets.success) {
    console.error(
      "❌ Invalid environment variables:",
      JSON.stringify(parsedSecrets.error.format(), null, 2),
    );
    process.exit(1);
  }
  envSecrets = parsedSecrets.data;
}

export function getEnvSecrets() {
  if (!envSecrets) {
    if (typeof window !== "undefined") {
      console.log("Calling secret from client");
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
