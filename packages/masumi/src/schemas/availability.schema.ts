import { z } from "zod";

export enum AvailabilityStatus {
  AVAILABLE = "available",
  UNAVAILABLE = "unavailable",
}

export enum AvailabilityType {
  MASUMI = "masumi-agent",
}

export const availabilityResponseSchema = z.object({
  status: z.enum(AvailabilityStatus),
  type: z.enum(AvailabilityType),
  message: z.string().nullish(),
});

export type AvailabilityResponseSchemaType = z.infer<
  typeof availabilityResponseSchema
>;
