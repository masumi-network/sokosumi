/* eslint-disable no-restricted-properties */
import z from "zod";

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

  NEXT_PUBLIC_MASUMI_URL: z.string().url().default("https://masumi.network"),
  NEXT_PUBLIC_KODOSUMI_URL: z.string().url().default("https://kodosumi.com"),
  NEXT_PUBLIC_SOKOSUMI_URL: z.string().url().default("https://sokosumi.com"),
  NEXT_PUBLIC_NETWORK: z.literal("Preprod").or(z.literal("Mainnet")),
  NEXT_PUBLIC_FEE_PERCENTAGE: z.coerce.number().min(0).default(5),
  NEXT_PUBLIC_CREDITS_BASE: z.coerce.number().default(12),
  NEXT_PUBLIC_AGENT_NEW_THRESHOLD_DAYS: z.coerce.number().min(0).default(7),
});

let envPublicConfig: z.infer<typeof envPublicConfigSchema>;

function validateEnv() {
  const parsedConfig = envPublicConfigSchema.safeParse({
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
    NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK,
    NEXT_PUBLIC_FEE_PERCENTAGE: process.env.NEXT_PUBLIC_FEE_PERCENTAGE,
    NEXT_PUBLIC_CREDITS_BASE: process.env.NEXT_PUBLIC_CREDITS_BASE,
    NEXT_PUBLIC_AGENT_NEW_THRESHOLD_DAYS:
      process.env.NEXT_PUBLIC_AGENT_NEW_THRESHOLD_DAYS,
  });
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
