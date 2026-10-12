import type { CoreHttpClient } from "../http-client.js";
import { type AgentJob, parseAgentJob } from "../models/agent-job.js";
import { type ApiResponse, parseApiResponse } from "../models/api-response.js";
import { type JobEvent, parseJobEvent } from "../models/job-event.js";
import {
  type JobFile,
  type JobLink,
  parseJobFile,
  parseJobLink,
} from "../models/job-output.js";
import { listResponse, requireId } from "../models/parse-helpers.js";

const JOBS_PATH = "/v1/jobs";

interface SubmitJobInputData {
  eventId?: string;
  inputData?: Record<string, unknown>;
}

export async function fetchJobs(
  client: CoreHttpClient,
  signal?: AbortSignal,
): Promise<{ jobs: AgentJob[] }> {
  const response = listResponse(
    parseApiResponse(await client.get<unknown>(JOBS_PATH, signal)),
  );
  return { jobs: response.data.map(parseAgentJob) };
}

export async function fetchJob(
  client: CoreHttpClient,
  jobId: string,
  signal?: AbortSignal,
): Promise<{ job: AgentJob }> {
  requireId(jobId, "jobId");
  const response = parseApiResponse(
    await client.get<unknown>(
      `${JOBS_PATH}/${encodeURIComponent(jobId)}`,
      signal,
    ),
  );
  return { job: parseAgentJob(response.data) };
}

export async function fetchJobEvents(
  client: CoreHttpClient,
  jobId: string,
  signal?: AbortSignal,
): Promise<{ events: JobEvent[] }> {
  requireId(jobId, "jobId");
  const response = listResponse(
    parseApiResponse(
      await client.get<unknown>(
        `${JOBS_PATH}/${encodeURIComponent(jobId)}/events`,
        signal,
      ),
    ),
  );
  return { events: response.data.map(parseJobEvent) };
}

export async function fetchJobFiles(
  client: CoreHttpClient,
  jobId: string,
  signal?: AbortSignal,
): Promise<{ files: JobFile[] }> {
  requireId(jobId, "jobId");
  const response = listResponse(
    parseApiResponse(
      await client.get<unknown>(
        `${JOBS_PATH}/${encodeURIComponent(jobId)}/files`,
        signal,
      ),
    ),
  );
  return { files: response.data.map(parseJobFile) };
}

export async function fetchJobLinks(
  client: CoreHttpClient,
  jobId: string,
  signal?: AbortSignal,
): Promise<{ links: JobLink[] }> {
  requireId(jobId, "jobId");
  const response = listResponse(
    parseApiResponse(
      await client.get<unknown>(
        `${JOBS_PATH}/${encodeURIComponent(jobId)}/links`,
        signal,
      ),
    ),
  );
  return { links: response.data.map(parseJobLink) };
}

export async function fetchJobInputRequest(
  client: CoreHttpClient,
  jobId: string,
  signal?: AbortSignal,
): Promise<{ inputRequest: unknown }> {
  requireId(jobId, "jobId");
  const response = parseApiResponse(
    await client.get<unknown>(
      `${JOBS_PATH}/${encodeURIComponent(jobId)}/input-request`,
      signal,
    ),
  );
  return { inputRequest: response.data };
}

export async function submitJobInput(
  client: CoreHttpClient,
  jobId: string,
  data: SubmitJobInputData = {},
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown> }> {
  requireId(jobId, "jobId");
  if (!data.eventId) throw new Error("eventId is required");
  const response = parseApiResponse(
    await client.post<unknown>(
      `${JOBS_PATH}/${encodeURIComponent(jobId)}/inputs`,
      {
        eventId: data.eventId,
        inputData: data.inputData ?? {},
      },
      signal,
    ),
  );
  return { response };
}
