import { coreClient } from "@/lib/clients/core.browser.client";

const workspaceOrganizationIdCache = new Map<string, string | null>();

export async function getWorkspaceOrganizationId(
  workspaceId: string,
): Promise<string | null | undefined> {
  if (workspaceOrganizationIdCache.has(workspaceId)) {
    return workspaceOrganizationIdCache.get(workspaceId);
  }

  try {
    const response = await coreClient.getWorkspaceOrganizationId(workspaceId);
    const organizationId = response.data.organizationId;
    workspaceOrganizationIdCache.set(workspaceId, organizationId);
    return organizationId;
  } catch (error) {
    console.warn("Failed to resolve workspace organization id:", error);
    return undefined;
  }
}
