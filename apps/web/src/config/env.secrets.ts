import "server-only";

/* eslint-disable no-restricted-properties */
import * as z from "zod";

/**
 * Official `@sparticuz/chromium-min` 152 x64 pack for Vercel PDF export.
 * Matches puppeteer / puppeteer-core 25.10.0 Chrome 152.0.7977.75
 * (pack binary is Chromium 152.0.7977.42).
 */
export const DEFAULT_CHROMIUM_EXECUTABLE_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v152.0.0/chromium-v152.0.0-pack.x64.tar";

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

  CHROMIUM_EXECUTABLE_URL: z.url().default(DEFAULT_CHROMIUM_EXECUTABLE_URL),

  MAINTENANCE_MODE: z
    .string()
    .transform((val: string) => val.trim().toLowerCase() === "true")
    .default(false),

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

  MASUMI_DESIGN_MD_API_KEY: z.string().min(1).optional(),
  MASUMI_DESIGN_MD_API_URL: z
    .url()
    .default("https://www.masumi.network/api/v1"),

  // HMAC secret for DESIGN.md job tokens (web-only).
  APP_SIGNING_SECRET: z.string().min(1),

  // Max pending invitations per organization (optional; default 100).
  ORG_INVITATION_LIMIT: z.coerce.number().min(0).default(100),

  // Ably TokenRequest mint moved to Core (ABLY_SUBSCRIBE_ONLY_KEY on Core).
  // Web /api/ably/auth proxies POST /v1/realtime/ably-token (SOK-741).
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
