import { z } from "zod";

export const startJobResponseSchema = z.object({
  input_hash: z.string(),
  job_id: z.string(),
  sellerVkey: z.string(),
  blockchainIdentifier: z.string(),
  submitResultTime: z.number({ coerce: true }).int(),
  unlockTime: z.number({ coerce: true }).int(),
  externalDisputeUnlockTime: z.number({ coerce: true }).int(),
});

export type StartJobResponseSchemaType = z.infer<typeof startJobResponseSchema>;
