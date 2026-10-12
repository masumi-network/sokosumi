import type { CoreHttpClient } from "../http-client.js";
import { parseApiResponse } from "../models/api-response.js";

export async function fetchPersonalWorkspaceAccess(
  client: CoreHttpClient,
  signal?: AbortSignal,
): Promise<boolean> {
  const { data } = parseApiResponse<unknown>(
    await client.get("/v1/users/me/workspaces", signal),
  );
  if (
    !data ||
    typeof data !== "object" ||
    !("workspaces" in data) ||
    !Array.isArray(data.workspaces)
  ) {
    throw new Error("Invalid Workspaces response: expected a workspaces array");
  }
  return data.workspaces.some(
    (workspace: unknown) =>
      !!workspace &&
      typeof workspace === "object" &&
      "kind" in workspace &&
      workspace.kind === "personal",
  );
}

export async function ensurePersonalWorkspace(
  client: CoreHttpClient,
  signal?: AbortSignal,
): Promise<void> {
  if (await fetchPersonalWorkspaceAccess(client, signal)) return;
  try {
    const { data } = parseApiResponse<unknown>(
      await client.post(
        "/v1/users/me/workspaces",
        { kind: "personal" },
        signal,
      ),
    );
    if (
      !data ||
      typeof data !== "object" ||
      !("id" in data) ||
      typeof data.id !== "string" ||
      !data.id.trim()
    ) {
      throw new Error(
        "Personal Workspace creation returned no ID. Inspect your account before retrying.",
      );
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      error.status === 409 &&
      (await fetchPersonalWorkspaceAccess(client, signal))
    )
      return;
    throw error;
  }
}

export async function verifyPersonalWorkspace(
  client: CoreHttpClient,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<void> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      workspaceId,
    )
  )
    throw new Error("Invalid personal Workspace ID");
  const { data } = parseApiResponse<unknown>(
    await client.get(`/v1/workspaces/${workspaceId}`, signal),
  );
  if (
    !data ||
    typeof data !== "object" ||
    !("organizationId" in data) ||
    data.organizationId !== null
  )
    throw new Error("Core did not confirm an authorized personal Workspace");
}
