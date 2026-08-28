import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  AdminSokoBotActionRequest,
  AdminSokoBotDetail,
  AdminSokoBotList,
  AdminSokoBotQuality,
  SokoBotGatewayModelList,
  SokoBotVersionDetail,
  SokoBotVersionList,
  SokoBotVersionWrite,
} from "@/lib/clients/generated/core";

export interface ListAdminSokoBotsParams {
  query?: string;
  cursor?: string;
  limit?: number;
}

export interface AdminSokoBotQualityParams {
  versionId?: string;
}

/** Platform-admin Soko Bot fleet reads and audited operator actions. */
export const adminSokoBotService = {
  async list(params: ListAdminSokoBotsParams = {}): Promise<AdminSokoBotList> {
    const response = await coreClient.listAdminSokoBots({
      query: params.query?.trim() || undefined,
      cursor: params.cursor,
      limit: params.limit,
    });
    return response.data;
  },

  async quality(
    params: AdminSokoBotQualityParams = {},
  ): Promise<AdminSokoBotQuality> {
    const response = await coreClient.getAdminSokoBotQuality({
      versionId: params.versionId,
    });
    return response.data;
  },

  async listVersions(): Promise<SokoBotVersionList> {
    const response = await coreClient.listAdminSokoBotVersions();
    return response.data;
  },

  async listGatewayModels(): Promise<SokoBotGatewayModelList> {
    const response = await coreClient.listAdminSokoBotGatewayModels();
    return response.data;
  },

  async createVersion(
    input: SokoBotVersionWrite,
  ): Promise<SokoBotVersionDetail> {
    const response = await coreClient.createAdminSokoBotVersion(input);
    return response.data;
  },

  async updateVersion(
    slug: string,
    input: Omit<SokoBotVersionWrite, "slug">,
  ): Promise<SokoBotVersionDetail> {
    const response = await coreClient.updateAdminSokoBotVersion(slug, input);
    return response.data;
  },

  async archiveVersion(slug: string): Promise<void> {
    await coreClient.archiveAdminSokoBotVersion(slug);
  },

  async promoteVersion(slug: string): Promise<{ defaultVersionId: string }> {
    const response = await coreClient.promoteAdminSokoBotVersion(slug);
    return response.data;
  },

  /** Full diagnostics for one bot, or `null` when it does not exist. */
  async get(sokoBotId: string): Promise<AdminSokoBotDetail | null> {
    try {
      const response = await coreClient.getAdminSokoBot(sokoBotId);
      return response.data;
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }
      throw error;
    }
  },

  async performAction(
    sokoBotId: string,
    input: AdminSokoBotActionRequest,
  ): Promise<AdminSokoBotDetail> {
    const response = await coreClient.performAdminSokoBotAction(
      sokoBotId,
      input,
    );
    return response.data;
  },
};
