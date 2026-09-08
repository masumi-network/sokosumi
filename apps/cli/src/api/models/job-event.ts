export interface JobEvent {
  id: string | null;
  jobId: string | null;
  type: string | null;
  message: string | null;
  data: unknown;
  createdAt: string | null;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export function parseJobEvent(input: unknown): JobEvent {
  const value = asRecord(input);
  return {
    id: typeof value.id === "string" ? value.id : null,
    jobId: typeof value.jobId === "string" ? value.jobId : null,
    type: typeof value.type === "string" ? value.type : null,
    message: typeof value.message === "string" ? value.message : null,
    data: "data" in value ? value.data : null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
  };
}
