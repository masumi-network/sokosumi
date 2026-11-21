import { z } from "@hono/zod-openapi";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const teamStandupSchema = z
  .object({
    enabled: z.boolean(),
    roomId: z.string().nullable(),
    timeOfDay: z.string().openapi({ example: "09:00" }),
    weekdays: z.array(z.number().int().min(1).max(7)),
    timezone: z.string().openapi({ example: "Europe/Berlin" }),
    nextRunAt: z.string().nullable(),
    lastRunAt: z.string().nullable(),
  })
  .openapi("TeamStandup");

export const updateTeamStandupSchema = z
  .object({
    enabled: z.boolean().optional(),
    timeOfDay: z
      .string()
      .regex(TIME, "Use HH:MM, 24-hour")
      .optional()
      .openapi({ description: "Local time in `timezone`, HH:MM." }),
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .optional()
      .openapi({ description: "1 Monday … 7 Sunday." }),
    timezone: z.string().trim().min(1).max(64).optional(),
  })
  .openapi("UpdateTeamStandup");
