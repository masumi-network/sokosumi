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
