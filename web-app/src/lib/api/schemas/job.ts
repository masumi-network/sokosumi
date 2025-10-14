import * as z from "zod";

import { JobStatus } from "@/lib/db/types";
import {
  AgentJobStatus,
  JobType,
  OnChainJobStatus,
} from "@/prisma/generated/client";

// Schema for creating a new job
export const createJobRequestSchema = z.object({
  maxAcceptedCredits: z.number().positive(),
  inputData: z.record(
    z.string(),
    z
      .union([
        z.number(),
        z.string(),
        z.boolean(),
        z.array(z.number()),
        z.undefined(),
      ])
      .optional(),
  ),
  name: z.string().min(1).max(80).optional(),
});

// Schema for credit information in responses
export const jobCreditsSchema = z.object({
  credits: z.number(),
  includedFee: z.number(),
});

// Main job response schema
export const jobResponseSchema = z.object({
  id: z.string(),
  createdAt: z.iso.datetime(), // ISO date string
  updatedAt: z.iso.datetime(), // ISO date string
  name: z.string().nullable(),
  status: z.enum(JobStatus),
  agentId: z.string(),
  userId: z.string(),
  organizationId: z.string().nullable(),
  agentJobId: z.string(),
  agentJobStatus: z.enum(AgentJobStatus).nullable(),
  onChainStatus: z.enum(OnChainJobStatus).nullable(),
  input: z.string(), // JSON string
  output: z.string().nullable(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  resultSubmittedAt: z.iso.datetime().nullable(),
  jobType: z.enum(JobType),
  price: jobCreditsSchema.nullable(),
  refund: jobCreditsSchema.nullable(),
  // Computed fields
  jobStatusSettled: z.boolean(),
});

// Response schema for jobs list endpoint
export const jobsListResponseSchema = z.object({
  jobs: z.array(jobResponseSchema),
  total: z.number(),
});

// Type exports for use in API routes and formatters
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;
export type JobCreditsResponse = z.infer<typeof jobCreditsSchema>;
export type JobResponse = z.infer<typeof jobResponseSchema>;
export type JobsListResponse = z.infer<typeof jobsListResponseSchema>;
