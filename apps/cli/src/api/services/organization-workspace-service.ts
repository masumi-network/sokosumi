import type { CoreHttpClient } from "../http-client.js";
import { type ApiResponse, parseApiResponse } from "../models/api-response.js";
import {
  type OrganizationWorkspace,
  parseOrganizationWorkspace,
} from "../models/organization-workspace.js";

export interface FetchOrganizationWorkspacesResult {
  response: ApiResponse<unknown[]>;
  organizationWorkspaces: OrganizationWorkspace[];
}

export async function fetchOrganizationWorkspaces(
  client: CoreHttpClient,
  signal?: AbortSignal,
): Promise<FetchOrganizationWorkspacesResult> {
  const response = parseApiResponse<unknown[]>(
    await client.get<unknown>("/v1/users/me/organizations", signal),
  );
  if (!Array.isArray(response.data)) {
    throw new Error(
      "Invalid organization workspace response: expected data array",
    );
  }
  const data = response.data;
  const normalizedResponse: ApiResponse<unknown[]> = { ...response, data };
  return {
    response: normalizedResponse,
    organizationWorkspaces: data.map(parseOrganizationWorkspace),
  };
}

export async function fetchOrganizationCallerSeat(
  client: CoreHttpClient,
  organizationId: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const id = organizationId.trim();
  if (!id || id === "." || id === "..") {
    throw new Error("Organization ID is required for the Workspace Seat check");
  }
  const timeout = AbortSignal.timeout(15_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  requestSignal.throwIfAborted();
  const response = await client.get<unknown>(
    `/v1/organizations/${encodeURIComponent(id)}/members/me/seat`,
    requestSignal,
  );
  requestSignal.throwIfAborted();
  const data =
    response && typeof response === "object" && "data" in response
      ? response.data
      : undefined;
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    !("assigned" in data) ||
    typeof data.assigned !== "boolean"
  ) {
    throw new Error(
      "Invalid Workspace Seat response: expected assigned boolean",
    );
  }
  return data.assigned;
}
