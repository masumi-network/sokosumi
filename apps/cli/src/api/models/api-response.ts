export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

export function parseApiResponse<T>(input: unknown): ApiResponse<T> {
  const record = asRecord(input);
  if (!record) {
    return { data: input as T };
  }

  const meta = asRecord(record.meta);
  return {
    data: ("data" in record ? record.data : record) as T,
    ...(meta ? { meta } : {}),
  };
}
