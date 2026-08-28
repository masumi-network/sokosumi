import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type {
  AdminCreateExternalChannelBody,
  AdminExternalChannelDetail,
  AdminExternalChannelGuest,
  AdminExternalChannelOption,
} from "@/lib/clients/generated/core";

export type {
  AdminCreateExternalChannelBody,
  AdminExternalChannelDetail,
  AdminExternalChannelGuest,
  AdminExternalChannelOption,
};

export const adminExternalChannelsService = {
  async listExternalChannels(
    organizationSlug: string,
  ): Promise<AdminExternalChannelOption[]> {
    const { data } =
      await coreClient.listAdminOrgExternalChannels(organizationSlug);
    return data ?? [];
  },

  async createExternalChannel(
    organizationSlug: string,
    body: AdminCreateExternalChannelBody,
  ): Promise<AdminExternalChannelOption> {
    const { data } = await coreClient.createAdminOrgExternalChannel(
      organizationSlug,
      body,
    );
    if (!data) {
      throw new Error("External channel create did not return data");
    }
    return data;
  },

  async getExternalChannel(
    organizationSlug: string,
    roomId: string,
  ): Promise<AdminExternalChannelDetail> {
    const { data } = await coreClient.getAdminOrgExternalChannel(
      organizationSlug,
      roomId,
    );
    if (!data) {
      throw new Error("External channel get did not return data");
    }
    return data;
  },

  async addGuest(
    organizationSlug: string,
    roomId: string,
    userId: string,
  ): Promise<AdminExternalChannelGuest> {
    const { data } = await coreClient.addAdminExternalChannelGuest(
      organizationSlug,
      roomId,
      { userId },
    );
    if (!data) {
      throw new Error("External channel guest add did not return data");
    }
    return data;
  },
};
