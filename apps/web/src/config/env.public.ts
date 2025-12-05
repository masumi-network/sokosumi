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

  NEXT_PUBLIC_MASUMI_URL: z.url().default("https://masumi.network"),
  NEXT_PUBLIC_KODOSUMI_URL: z.url().default("https://kodosumi.com"),
  NEXT_PUBLIC_SOKOSUMI_URL: z.url().default("https://app.sokosumi.com"),
  NEXT_PUBLIC_MCP_URL: z.url().default("https://mcp.sokosumi.com"),
  NEXT_PUBLIC_NETWORK: z
    .literal("Preprod")
    .or(z.literal("Mainnet"))
    .default("Preprod"),
  NEXT_PUBLIC_FEE_PERCENTAGE: z.coerce.number().min(0).default(5),
  NEXT_PUBLIC_CREDITS_BASE: z.coerce.number().default(12),
  NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD: z.coerce
    .number()
    .min(0)
    .default(30),
  NEXT_PUBLIC_SHOW_EMERGENCY_DIALOG: z.coerce.boolean().default(false),
});

let envPublicConfig: z.infer<typeof envPublicConfigSchema>;

function validateEnv() {
  const parsedConfig = envPublicConfigSchema.safeParse(process.env);
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
