export interface AgentJob {
  id: string | null;
  agentId: string | null;
  status: string | null;
  name: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function parseAgentJob(input: unknown): AgentJob {
  const record = asRecord(input);
  return {
    id: nullableString(record.id),
    agentId: nullableString(record.agentId ?? record.agent_id),
    status: nullableString(record.status),
    name: nullableString(record.name),
    createdAt: nullableString(record.createdAt),
    updatedAt: nullableString(record.updatedAt),
  };
}
