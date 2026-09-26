import { asRecord, nullableString } from "./parse-helpers.js";

export interface AgentJob {
  id: string | null;
  agentId: string | null;
  status: string | null;
  name: string | null;
  result: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export function parseAgentJob(input: unknown): AgentJob {
  const record = asRecord(input);
  return {
    id: nullableString(record.id),
    agentId: nullableString(record.agentId ?? record.agent_id),
    status: nullableString(record.status),
    name: nullableString(record.name),
    result: nullableString(record.result),
    createdAt: nullableString(record.createdAt),
    updatedAt: nullableString(record.updatedAt),
  };
}
