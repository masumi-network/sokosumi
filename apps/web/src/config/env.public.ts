/* eslint-disable no-restricted-properties */
import * as z from "zod";

const envPublicConfigSchema = z.object({
  NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID: z.string().optional(),
  NEXT_PUBLIC_GOOGLE_ANALYTICS_ID: z.string().optional(),
  NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME: z.coerce
    .number()
    .min(0)
    .default(300),
  NEXT_PUBLIC_PASSWORD_MIN_LENGTH: z.coerce.number().min(8).max(20).default(8),
  NEXT_PUBLIC_PASSWORD_MAX_LENGTH: z.coerce
    .number()
    .min(10)
    .max(256)
    .default(256),

  NEXT_PUBLIC_MASUMI_URL: z.url().default("https://www.masumi.network"),
  NEXT_PUBLIC_KODOSUMI_URL: z.url().default("https://kodosumi.com"),
  NEXT_PUBLIC_SOKOSUMI_URL: z.url().default("https://app.sokosumi.com"),
  NEXT_PUBLIC_HANNAH_URL: z.url().default("https://hannah.sumike.ai"),
  NEXT_PUBLIC_MCP_URL: z.url().default("https://mcp.sokosumi.com"),
  NEXT_PUBLIC_CORE_APP_BASE_URL: z.url().optional(),
  NEXT_PUBLIC_USE_CORE_AUTH_CLIENT: z.coerce.boolean().default(false),
  NEXT_PUBLIC_NETWORK: z
    .literal("Preprod")
    .or(z.literal("Mainnet"))
    .default("Preprod"),
  NEXT_PUBLIC_VERCEL_ENV: z
    .enum(["production", "preview", "development"])
    .optional(),
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: z.string().optional(),
  NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD: z.coerce
    .number()
    .min(0)
    .default(100),
  NEXT_PUBLIC_SHOW_EMERGENCY_DIALOG: z.coerce.boolean().default(false),
});

let envPublicConfig: z.infer<typeof envPublicConfigSchema>;

function validateEnv() {
  const rawEnv = {
    NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID:
      process.env.NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID,
    NEXT_PUBLIC_GOOGLE_ANALYTICS_ID:
      process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID,
    NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME:
      process.env.NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME,
    NEXT_PUBLIC_PASSWORD_MIN_LENGTH:
      process.env.NEXT_PUBLIC_PASSWORD_MIN_LENGTH,
    NEXT_PUBLIC_PASSWORD_MAX_LENGTH:
      process.env.NEXT_PUBLIC_PASSWORD_MAX_LENGTH,
    NEXT_PUBLIC_MASUMI_URL: process.env.NEXT_PUBLIC_MASUMI_URL,
    NEXT_PUBLIC_KODOSUMI_URL: process.env.NEXT_PUBLIC_KODOSUMI_URL,
    NEXT_PUBLIC_SOKOSUMI_URL: process.env.NEXT_PUBLIC_SOKOSUMI_URL,
    NEXT_PUBLIC_HANNAH_URL: process.env.NEXT_PUBLIC_HANNAH_URL,
    NEXT_PUBLIC_MCP_URL: process.env.NEXT_PUBLIC_MCP_URL,
    NEXT_PUBLIC_CORE_APP_BASE_URL: process.env.NEXT_PUBLIC_CORE_APP_BASE_URL,
    NEXT_PUBLIC_USE_CORE_AUTH_CLIENT:
      process.env.NEXT_PUBLIC_USE_CORE_AUTH_CLIENT,
    NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF:
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF,
    NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD:
      process.env.NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD,
    NEXT_PUBLIC_SHOW_EMERGENCY_DIALOG:
      process.env.NEXT_PUBLIC_SHOW_EMERGENCY_DIALOG,
  };

  const parsedConfig = envPublicConfigSchema.safeParse(rawEnv);
  if (!parsedConfig.success) {
    console.error(
      "❌ Invalid environment variables:",
      JSON.stringify(parsedConfig.error.format(), null, 2),
    );
    process.exit(1);
  }
  envPublicConfig = parsedConfig.data;
}

export function getEnvPublicConfig() {
  if (!envPublicConfig) {
    validateEnv();
  }
  return envPublicConfig;
}
