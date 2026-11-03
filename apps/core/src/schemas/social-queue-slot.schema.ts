import { z } from "@hono/zod-openapi";
import { isValidTimezone } from "@sokosumi/utils";

import { socialPostProjectParamsSchema } from "@/schemas/social-post.schema";

export const socialQueueSlotProjectParamsSchema = socialPostProjectParamsSchema;

const socialQueueTimezoneSchema = z
  .string()
  .refine((value) => isValidTimezone(value), {
    message: "timezone must be a valid IANA time zone",
  })
  .openapi({ example: "Europe/Zurich" });

export const socialQueueSlotSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(40).openapi({ example: "Tuesday morning" }),
    weekday: z.number().int().min(0).max(6).openapi({ example: 2 }),
    minutesFromMidnight: z
      .number()
      .int()
      .min(0)
      .max(1439)
      .openapi({ example: 540 }),
    timezone: socialQueueTimezoneSchema,
  })
  .openapi("SocialQueueSlot");

export const socialQueueSlotWriteSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    weekday: z.number().int().min(0).max(6),
    minutesFromMidnight: z.number().int().min(0).max(1439),
  })
  .openapi("SocialQueueSlotWrite");

export const replaceSocialQueueSlotsRequestSchema = z
  .object({
    timezone: socialQueueTimezoneSchema,
    slots: z.array(socialQueueSlotWriteSchema).max(50),
  })
  .refine(
    (value) => {
      const keys = value.slots.map(
        (slot) => `${slot.weekday}:${slot.minutesFromMidnight}`,
      );
      return new Set(keys).size === keys.length;
    },
    { message: "Each weekday and time can be used once" },
  )
  .openapi("ReplaceSocialQueueSlotsRequest");

export const socialQueueSlotsResponseSchema = z
  .object({
    timezone: socialQueueTimezoneSchema.nullable(),
    slots: z.array(socialQueueSlotSchema),
  })
  .openapi("SocialQueueSlots");

export const queueSocialPostRequestSchema = z
  .object({
    revision: z.number().int().min(0),
    socialConnectionId: z.string().uuid().optional(),
  })
  .openapi("QueueSocialPostRequest");
