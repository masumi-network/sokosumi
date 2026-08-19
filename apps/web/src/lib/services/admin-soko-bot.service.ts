import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  AdminSokoBotActionRequest,
  AdminSokoBotDetail,
  AdminSokoBotList,
} from "@/lib/clients/generated/core";

export interface ListAdminSokoBotsParams {
  query?: string;
  cursor?: string;
  limit?: number;
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
