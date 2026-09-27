import { parseApiResponse } from "./api-response.js";

export interface CoworkerWorkspaceAccess {
  id: string;
  coworkerId: string;
  workspaceId: string;
  status: string;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Invalid coworker workspace access response: missing ${field}`,
    );
  }
  return value;
}

export function parseCoworkerWorkspaceAccess(
  input: unknown,
): CoworkerWorkspaceAccess {
  const value = asRecord(input);
  return {
    id: requiredString(value.id, "id"),
    coworkerId: requiredString(value.coworkerId, "coworkerId"),
    workspaceId: requiredString(value.workspaceId, "workspaceId"),
    status: requiredString(value.status, "status"),
  };
}

export function parseCoworkerWorkspaceAccessResponse(input: unknown) {
  const response = parseApiResponse<unknown>(input);
  return {
    response,
    access: parseCoworkerWorkspaceAccess(response.data),
  };
}
