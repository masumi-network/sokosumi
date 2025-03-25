import { z } from "zod";

/**
 * Specify your environment variables schema here.
 * This way you can ensure the app isn't built with invalid env vars.
 */
const envSchemaSecrets = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Authentication
  BETTER_AUTH_SECRET: z.string().nonempty(),
  RESEND_API_KEY: z.string().nonempty(),

  // Social Providers
  GOOGLE_CLIENT_SECRET: z.string().nonempty(),
  MICROSOFT_CLIENT_SECRET: z.string().nonempty(),
  APPLE_CLIENT_SECRET: z.string().nonempty(),
  LINKEDIN_CLIENT_SECRET: z.string().nonempty(),
});

const envSchemaConfig = z.object({
  KEYBOARD_INPUT_DEBOUNCE_TIME: z.number().min(0).default(300),

  MASUMI_URL: z.string().url().default("https://masumi.network"),
  KODOSUMI_URL: z.string().url().default("https://kodosumi.com"),
  SOKOSUMI_URL: z.string().url().default("https://sokosumi.com"),

  PASSWORD_MIN_LENGTH: z.number().min(8).max(20).default(8),
  PASSWORD_MAX_LENGTH: z.number().min(10).max(256).default(256),

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

  // LinkedIn
  LINKEDIN_CLIENT_ID: z.string().nonempty(),

  // Apple
  APPLE_CLIENT_ID: z.string().nonempty(),

  // Microsoft
  MICROSOFT_CLIENT_ID: z.string().nonempty(),
  // Google
  GOOGLE_CLIENT_ID: z.string().nonempty(),
  NOREPLY_EMAIL: z.string().email(),
});

/**
 * Validate that all environment variables are set and valid
 */

export function validateEnv() {
  // eslint-disable-next-line no-restricted-properties
  const parsedSecrets = envSchemaSecrets.safeParse(process.env);
  // eslint-disable-next-line no-restricted-properties
  const parsedConfig = envSchemaConfig.safeParse(process.env);

  if (!parsedSecrets.success) {
    console.error(
      "❌ Invalid environment variables:",
      JSON.stringify(parsedSecrets.error.format(), null, 2),
    );
    process.exit(1);
  }

  if (!parsedConfig.success) {
    console.error(
      "❌ Invalid environment variables:",
      JSON.stringify(parsedConfig.error.format(), null, 2),
    );
    process.exit(1);
  }
}

// eslint-disable-next-line no-restricted-properties
export const envSecrets = envSchemaSecrets.parse(process.env);

// eslint-disable-next-line no-restricted-properties
export const envConfig = envSchemaConfig.parse(process.env);
