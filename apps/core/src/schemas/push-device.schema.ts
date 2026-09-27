import { z } from "@hono/zod-openapi";

export const pushDeviceSchema = z
  .object({
    id: z.string(),
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
