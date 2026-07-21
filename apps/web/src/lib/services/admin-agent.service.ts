import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  AdminAgentDetail,
  AdminAgentListItem,
  PatchAdminAgentMetadataOverrideBody,
} from "@/lib/clients/generated/core";

export interface AdminAgentListPage {
  agents: AdminAgentListItem[];
  total: number;
  nextCursor: string | null;
}

export interface ListAdminAgentsParams {
  q?: string;
  cursor?: string;
  limit?: number;
  sortBy?:
    | "displayName"
    | "registryName"
    | "hasOverride"
    | "status"
    | "createdAt";
  sortOrder?: "asc" | "desc";
}

export const adminAgentService = {
  async listAgents(
    params: ListAdminAgentsParams = {},
  ): Promise<AdminAgentListPage> {
    const result = await coreClient.listAdminAgents(params);

    return {
      agents: result.data,
      total: result.meta.pagination.total,
      nextCursor: result.meta.pagination.nextCursor,
    };
  },

  async getAgent(agentId: string): Promise<AdminAgentDetail | null> {
    try {
      const result = await coreClient.getAdminAgent(agentId);
      return result.data;
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }
      throw error;
    }
  },

  async patchMetadataOverride(
    agentId: string,
    body: PatchAdminAgentMetadataOverrideBody,
  ): Promise<AdminAgentDetail> {
    const result = await coreClient.patchAdminAgentMetadataOverride(
      agentId,
      body,
    );
    return result.data;
  },

  async deleteMetadataOverride(agentId: string): Promise<AdminAgentDetail> {
    const result = await coreClient.deleteAdminAgentMetadataOverride(agentId);
    return result.data;
  },
};
