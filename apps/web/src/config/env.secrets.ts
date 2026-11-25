import "server-only";

import * as z from "zod";
import { studioRouterTrialSchema } from "../../agents/image-studio/agent/lib/router-trial";

/**
 * Official `@sparticuz/chromium-min` 158 x64 pack for Vercel PDF export.
 * puppeteer / puppeteer-core 25.18.1 target Chrome 157.0.8103.78.
 * Sparticuz publishes no 154–157 pack (153.0.0, then 158.0.0), so the
 * downloadable binary is Chromium 158.
 */
export const DEFAULT_CHROMIUM_EXECUTABLE_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v158.0.0/chromium-v158.0.0-pack.x64.tar";

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

  MASUMI_DESIGN_MD_API_KEY: z.string().min(1).optional(),
  MASUMI_DESIGN_MD_API_URL: z
    .url()
    .default("https://www.masumi.network/api/v1"),

  // HMAC secret for DESIGN.md job tokens (web-only).
  APP_SIGNING_SECRET: z.string().min(1),
  /**
   * Shared with Core and with the image-studio agent. Web mints the
   * short-lived studio token the browser hands to the agent; the agent mints
   * the grant it presents to Core. Absent, the studio chat is unavailable and
   * says so — it never falls back to an unauthenticated agent.
   */
  IMAGE_STUDIO_AGENT_SECRET: z.string().min(32).optional(),
  STUDIO_AGENT_ROUTER_TRIAL: studioRouterTrialSchema,

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
