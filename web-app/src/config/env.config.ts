import { z } from "zod";

/**
 * Specify your environment variables schema here.
 * This way you can ensure the app isn't built with invalid env vars.
 */
const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Authentication
  NOREPLY_EMAIL: z.string().email(),
  BETTER_AUTH_SECRET: z.string().nonempty(),
  RESEND_API_KEY: z.string().nonempty(),

  // Social Providers
  // Google
  GOOGLE_CLIENT_ID: z.string().nonempty(),
  GOOGLE_CLIENT_SECRET: z.string().nonempty(),

  // Microsoft
  MICROSOFT_CLIENT_ID: z.string().nonempty(),
  MICROSOFT_CLIENT_SECRET: z.string().nonempty(),

  // Apple
  APPLE_CLIENT_ID: z.string().nonempty(),
  APPLE_CLIENT_SECRET: z.string().nonempty(),

  // LinkedIn
  LINKEDIN_CLIENT_ID: z.string().nonempty(),
  LINKEDIN_CLIENT_SECRET: z.string().nonempty(),
});

/**
 * Validate that all environment variables are set and valid
 */
export function validateEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error(
      "❌ Invalid environment variables:",
      JSON.stringify(parsed.error.format(), null, 2),
    );
    process.exit(1);
  }
}
