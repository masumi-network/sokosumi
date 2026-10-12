import type { CoreHttpClient } from "../http-client.js";
import { type Agent, parseAgent } from "../models/agent.js";
import { type AgentJob, parseAgentJob } from "../models/agent-job.js";
import { parseApiResponse } from "../models/api-response.js";
import { asRecord, listResponse, requireId } from "../models/parse-helpers.js";

interface CreateAgentJobOptions {
  inputSchema: unknown;
  inputData?: unknown;
  maxCredits?: number;
  name?: string;
}

export async function fetchAgents(
  client: CoreHttpClient,
  signal?: AbortSignal,
): Promise<{ agents: Agent[] }> {
  const response = listResponse(
    parseApiResponse(await client.get<unknown>("/v1/agents", signal)),
  );
  return { agents: response.data.map(parseAgent) };
}

export async function fetchAgentInputSchema(
  client: CoreHttpClient,
  agentId: string,
  signal?: AbortSignal,
): Promise<{ schema: Record<string, unknown> }> {
  requireId(agentId, "agentId");
  const response = parseApiResponse<unknown>(
    await client.get<unknown>(
      `/v1/agents/${encodeURIComponent(agentId)}/input-schema`,
      signal,
    ),
  );
  return { schema: asRecord(response.data) };
}

export async function createAgentJob(
  client: CoreHttpClient,
  agentId: string,
  { inputSchema, inputData = {}, maxCredits, name }: CreateAgentJobOptions,
  signal?: AbortSignal,
): Promise<{ job: AgentJob }> {
  requireId(agentId, "agentId");
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
  return { job: parseAgentJob(response.data) };
}
