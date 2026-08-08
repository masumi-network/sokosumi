import { z } from "@hono/zod-openapi";

/**
 * The provider's address for one app install.
 *
 * Expo hands the app a token of the form `ExponentPushToken[…]`, and Core
 * treats it as opaque: it is an address to send to, not a credential, and
 * validating its shape here would only break the day Expo changes it. Length is
 * bounded because it goes in an index.
 */
export const pushDeviceTokenSchema = z.string().min(1).max(512).openapi({
  description: "Opaque push token issued to this app install by the provider",
  example: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
});

export const pushDevicePlatformSchema = z.enum(["IOS", "ANDROID"]).openapi({
  description: "Which app store build this token came from",
  example: "IOS",
});

export const registerPushDeviceRequestSchema = z
  .object({
    token: pushDeviceTokenSchema,
    platform: pushDevicePlatformSchema,
  })
  .openapi("RegisterPushDeviceRequest");

export const pushDeviceSchema = z
  .object({
    id: z.string().openapi({ example: "0199c0f0-0000-7000-8000-000000000000" }),
    platform: pushDevicePlatformSchema,
    lastSeenAt: z.date().openapi({ example: "2026-08-08T09:00:00.000Z" }),
    createdAt: z.date().openapi({ example: "2026-08-08T09:00:00.000Z" }),
  })
  .openapi("PushDevice");

export type RegisterPushDeviceRequest = z.infer<
  typeof registerPushDeviceRequestSchema
>;
