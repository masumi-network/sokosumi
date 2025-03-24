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
  BETTER_AUTH_SECRET: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),

  // Social Providers
  // Google
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  // Microsoft
  MICROSOFT_CLIENT_ID: z.string().min(1),
  MICROSOFT_CLIENT_SECRET: z.string().min(1),

  // Apple
  APPLE_CLIENT_ID: z.string().min(1),
  APPLE_CLIENT_SECRET: z.string().min(1),

  // LinkedIn
  LINKEDIN_CLIENT_ID: z.string().min(1),
  LINKEDIN_CLIENT_SECRET: z.string().min(1),
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
