import { z } from "@hono/zod-openapi";

export const pushDeviceBrowserDetailsSchema = z
  .object({
    browser: z.enum([
      "Chrome",
      "Edge",
      "Firefox",
      "Safari",
      "Opera",
      "Samsung Internet",
    ]),
    operatingSystem: z.enum([
      "macOS",
      "Windows",
      "Windows Phone",
      "Android",
      "iOS",
      "Linux",
      "ChromeOS",
    ]),
  })
  .openapi("PushDeviceBrowserDetails");

export type PushDeviceBrowserDetails = z.infer<
  typeof pushDeviceBrowserDetailsSchema
>;

export const pushDeviceBrowserUpdateSchema = pushDeviceBrowserDetailsSchema
  .partial()
  .extend({ registeredAt: z.iso.datetime().optional() })
  .strict()
  .refine(
    ({ browser, operatingSystem }) =>
      Boolean(browser) === Boolean(operatingSystem),
    { message: "Browser and operating system must be provided together" },
  )
  .refine(({ browser, registeredAt }) => Boolean(browser || registeredAt), {
    message: "Provide browser details or a registration date",
  })
  .openapi("PushDeviceBrowserUpdate");

export type PushDeviceBrowserUpdate = z.infer<
  typeof pushDeviceBrowserUpdateSchema
>;

export const pushDeviceSchema = z
  .object({
    id: z.string(),
    browserDetails: pushDeviceBrowserDetailsSchema.optional(),
    registeredAt: z.iso.datetime().optional(),
    platform: z.enum(["browser", "ios", "android", "unknown"]),
    formFactor: z.enum([
      "phone",
      "tablet",
      "desktop",
      "tv",
      "watch",
      "car",
      "embedded",
      "other",
    ]),
    state: z.enum(["active", "failing", "failed", "unknown"]),
  })
  .openapi("PushDevice");

export type PushDevice = z.infer<typeof pushDeviceSchema>;

export const pushDeviceActivationRequestSchema = z
  .object({
    consentId: z.uuid().optional(),
    deviceId: z.string().min(1).max(256),
    readerInitiated: z.boolean(),
  })
  .strict()
  .openapi("PushDeviceActivationRequest");

export const pushDeviceActivationSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().nonnegative(),
    revoked: z.boolean(),
    replaceDevice: z.boolean(),
  })
  .openapi("PushDeviceActivation");

export const pushDeviceSubscriptionRequestSchema = z
  .object({
    consentId: z.uuid(),
    revision: z.number().int().nonnegative().max(2147483647),
  })
  .strict()
  .openapi("PushDeviceSubscriptionRequest");
