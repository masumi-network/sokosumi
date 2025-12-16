import { z } from "zod";

// Availability status values - single source of truth
export const AVAILABILITY_STATUS = ["available", "unavailable"] as const;

export type AvailabilityStatus = (typeof AVAILABILITY_STATUS)[number];

// Availability type values - single source of truth
export const AVAILABILITY_TYPE = ["masumi-agent"] as const;

export type AvailabilityType = (typeof AVAILABILITY_TYPE)[number];

export const availabilityResponseSchema = z.object({
  status: z.enum(AVAILABILITY_STATUS),
  type: z.enum(AVAILABILITY_TYPE),
  message: z.string().nullish(),
});

export type AvailabilityResponseSchemaType = z.infer<
  typeof availabilityResponseSchema
>;
