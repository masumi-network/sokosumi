import type { CoreHttpClient } from "../http-client.js";
import { type Agent, parseAgent } from "../models/agent.js";
import { type AgentJob, parseAgentJob } from "../models/agent-job.js";
import { type ApiResponse, parseApiResponse } from "../models/api-response.js";

export interface FetchAgentsResult {
  response: ApiResponse<unknown[]>;
  agents: Agent[];
}

export interface FetchAgentInputSchemaResult {
  response: ApiResponse<unknown>;
  schema: Record<string, unknown>;
  fields: unknown[];
}

export interface CreateAgentJobOptions {
  inputSchema: unknown;
  inputData?: unknown;
  maxCredits?: number;
  name?: string;
}

export async function fetchAgents(
  client: CoreHttpClient,
  signal?: AbortSignal,
): Promise<FetchAgentsResult> {
  const response = parseApiResponse<unknown[]>(
    await client.get<unknown>("/v1/agents", signal),
  );
  const data = Array.isArray(response.data) ? response.data : [];
  const normalizedResponse: ApiResponse<unknown[]> = { ...response, data };
  return {
    response: normalizedResponse,
    agents: data.map(parseAgent),
  };
}

export async function fetchAgentJobs(
  client: CoreHttpClient,
  agentId: string,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown[]>; jobs: AgentJob[] }> {
  const response = parseApiResponse<unknown[]>(
    await client.get<unknown>(
      `/v1/agents/${encodeURIComponent(agentId)}/jobs`,
      signal,
    ),
  );
  const data = Array.isArray(response.data) ? response.data : [];
  const normalizedResponse: ApiResponse<unknown[]> = { ...response, data };
  return {
    response: normalizedResponse,
    jobs: data.map(parseAgentJob),
  };
}

function extractInputSchemaFields(schema: Record<string, unknown>): unknown[] {
  if (Array.isArray(schema.input_data)) return schema.input_data;
  if (!Array.isArray(schema.input_groups)) return [];
  return schema.input_groups.flatMap((group) => {
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      return [];
    }
    const inputData = (group as Record<string, unknown>).input_data;
    return Array.isArray(inputData) ? inputData : [];
  });
}

export async function fetchAgentInputSchema(
  client: CoreHttpClient,
  agentId: string,
  signal?: AbortSignal,
): Promise<FetchAgentInputSchemaResult> {
  if (!agentId) throw new Error("agentId is required");
  const response = parseApiResponse<unknown>(
    await client.get<unknown>(
      `/v1/agents/${encodeURIComponent(agentId)}/input-schema`,
      signal,
    ),
  );
  const schema =
    response.data &&
    typeof response.data === "object" &&
    !Array.isArray(response.data)
      ? (response.data as Record<string, unknown>)
      : {};
  return {
    response,
    schema,
    fields: extractInputSchemaFields(schema),
  };
}

export async function createAgentJob(
  client: CoreHttpClient,
  agentId: string,
  { inputSchema, inputData = {}, maxCredits, name }: CreateAgentJobOptions,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown>; job: AgentJob }> {
  if (!agentId) throw new Error("agentId is required");
  if (inputSchema === undefined || inputSchema === null) {
    throw new Error("inputSchema is required");
  }
  const payload = {
    inputSchema,
    inputData,
    maxCredits:
      Number.isFinite(maxCredits) && (maxCredits as number) > 0
        ? maxCredits
        : undefined,
    name: name?.trim() || undefined,
  };
  const response = parseApiResponse<unknown>(
    await client.post<unknown>(
      `/v1/agents/${encodeURIComponent(agentId)}/jobs`,
      payload,
      signal,
    ),
  );
  return { response, job: parseAgentJob(response.data) };
}
