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

const JOBS_PATH = "/v1/jobs";

export interface SubmitJobInputData {
  eventId?: string;
  inputData?: Record<string, unknown>;
}

function requireId(id: string, name: string): void {
  if (!id) throw new Error(`${name} is required`);
}

function listResponse(parsed: ApiResponse<unknown>): ApiResponse<unknown[]> {
  return { ...parsed, data: Array.isArray(parsed.data) ? parsed.data : [] };
}

export async function fetchJobs(
  client: CoreHttpClient,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown[]>; jobs: AgentJob[] }> {
  const response = listResponse(
    parseApiResponse(await client.get<unknown>(JOBS_PATH, signal)),
  );
  return { response, jobs: response.data.map(parseAgentJob) };
}

export async function fetchJob(
  client: CoreHttpClient,
  jobId: string,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown>; job: AgentJob }> {
  requireId(jobId, "jobId");
  const response = parseApiResponse(
    await client.get<unknown>(
      `${JOBS_PATH}/${encodeURIComponent(jobId)}`,
      signal,
    ),
  );
  return { response, job: parseAgentJob(response.data) };
}

export async function fetchJobEvents(
  client: CoreHttpClient,
  jobId: string,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown[]>; events: JobEvent[] }> {
  requireId(jobId, "jobId");
  const response = listResponse(
    parseApiResponse(
      await client.get<unknown>(
        `${JOBS_PATH}/${encodeURIComponent(jobId)}/events`,
        signal,
      ),
    ),
  );
  return { response, events: response.data.map(parseJobEvent) };
}

export async function fetchJobFiles(
  client: CoreHttpClient,
  jobId: string,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown[]>; files: JobFile[] }> {
  requireId(jobId, "jobId");
  const response = listResponse(
    parseApiResponse(
      await client.get<unknown>(
        `${JOBS_PATH}/${encodeURIComponent(jobId)}/files`,
        signal,
      ),
    ),
  );
  return { response, files: response.data.map(parseJobFile) };
}

export async function fetchJobLinks(
  client: CoreHttpClient,
  jobId: string,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown[]>; links: JobLink[] }> {
  requireId(jobId, "jobId");
  const response = listResponse(
    parseApiResponse(
      await client.get<unknown>(
        `${JOBS_PATH}/${encodeURIComponent(jobId)}/links`,
        signal,
      ),
    ),
  );
  return { response, links: response.data.map(parseJobLink) };
}

export async function fetchJobInputRequest(
  client: CoreHttpClient,
  jobId: string,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown>; inputRequest: unknown }> {
  requireId(jobId, "jobId");
  const response = parseApiResponse(
    await client.get<unknown>(
      `${JOBS_PATH}/${encodeURIComponent(jobId)}/input-request`,
      signal,
    ),
  );
  return { response, inputRequest: response.data };
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
