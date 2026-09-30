import type { ApiResponse } from "./api-response.js";

export function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export function requireId(id: string, name: string): void {
  if (!id) throw new Error(`${name} is required`);
}

export function listResponse(
  parsed: ApiResponse<unknown>,
): ApiResponse<unknown[]> {
  return { ...parsed, data: Array.isArray(parsed.data) ? parsed.data : [] };
}

export function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
