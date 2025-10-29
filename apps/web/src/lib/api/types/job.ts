// Explicit TypeScript types for jobs endpoints (for next-openapi-gen typescript mode)

import { JobShareRequestBody, JobShareResponse } from "./job-share";

export type JobType = "FREE" | "PAID" | "DEMO";

export type JobCredits = {
  credits: number;
  includedFee: number;
};

export type JobResponse = {
  id: string;
  createdAt: string; // ISO date
  updatedAt: string; // ISO date
  name: string | null;
  status: string; // JobStatus
  agentId: string;
  userId: string;
  organizationId: string | null;
  agentJobId: string;
  agentJobStatus: string | null;
  onChainStatus: string | null;
  input: string;
  output: string | null;
  startedAt: string; // ISO date
  completedAt: string | null; // ISO date
  resultSubmittedAt: string | null; // ISO date
  jobType: JobType;
  price: JobCredits | null;
  refund: JobCredits | null;
  shares: JobShareResponse[];
  // computed fields
  jobStatusSettled: boolean;
};

export type JobsSuccessResponse = {
  success: true;
  data: JobResponse[];
  timestamp: string;
};

export type JobSuccessResponse = {
  success: true;
  data: JobResponse;
  timestamp: string;
};

export type CreateJobBody = {
  maxAcceptedCredits: number;
  inputData?: Record<string, number | string | boolean | number[] | undefined>;
  name?: string;
  jobShareRequest?: JobShareRequestBody;
};

export type JobParams = {
  jobId: string;
};

export type JobQueryParams = {
  agentId?: string;
  status?: string;
};
