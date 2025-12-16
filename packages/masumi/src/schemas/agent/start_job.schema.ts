import * as z from "zod";

import {
  provideInputDataSchema,
  provideInputGroupsSchema,
} from "../input/input.schema.js";

// Preprocess helper for backwards compatibility: normalize job_id to id
// Id is required in the Masumi Docs, but some agents return job_id instead.
function preprocessJobId(val: unknown): unknown {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    return {
      ...obj,
      id: obj.id ?? obj.job_id,
    };
  }
  return val;
}

export const startJobRequestSchema = z.object({
  identifierFromPurchaser: z.string(),
  provideInputDataSchema,
  provideInputGroupsSchema,
});

// Base schema for FREE jobs with preprocessing
export const startFreeJobResponseSchema = z.preprocess(
  preprocessJobId,
  z.object({
    id: z.string().min(1),
  }),
);

export type StartFreeJobResponseSchemaType = z.infer<
  typeof startFreeJobResponseSchema
>;

// Schema for PAID jobs with preprocessing (cannot extend preprocessed schema)
export const startPaidJobResponseSchema = z.preprocess(
  preprocessJobId,
  z.object({
    id: z.string().min(1),
    input_hash: z.string().min(1),
    identifierFromPurchaser: z.string().min(1),
    blockchainIdentifier: z.string().min(1),
    payByTime: z.coerce.number().int(),
    submitResultTime: z.coerce.number().int(),
    unlockTime: z.coerce.number().int(),
    externalDisputeUnlockTime: z.coerce.number().int(),
    agentIdentifier: z.string().min(1),
    sellerVKey: z.string().min(1),
  }),
);

export type StartPaidJobResponseSchemaType = z.infer<
  typeof startPaidJobResponseSchema
>;
