import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type {
  AdminAddMatchedChannelFromOrganizationResult,
  AdminCreateMatchedChannelBody,
  AdminMatchedChannelDetail,
  AdminMatchedChannelOption,
  AdminMatchedChannelParticipant,
  AdminRemoveMatchedChannelParticipant,
} from "@/lib/clients/generated/core";

export type {
  AdminAddMatchedChannelFromOrganizationResult,
  AdminCreateMatchedChannelBody,
  AdminMatchedChannelDetail,
  AdminMatchedChannelOption,
  AdminMatchedChannelParticipant,
  AdminRemoveMatchedChannelParticipant,
};

export const adminMatchedChannelsService = {
  async listMatchedChannels(): Promise<AdminMatchedChannelOption[]> {
    const { data } = await coreClient.listAdminMatchedChannels();
    return data ?? [];
  },

  async createMatchedChannel(
    body: AdminCreateMatchedChannelBody,
  ): Promise<AdminMatchedChannelOption> {
    const { data } = await coreClient.createAdminMatchedChannel(body);
    if (!data) {
      throw new Error("Matched channel create did not return data");
    }
    return data;
  },

  async getMatchedChannel(roomId: string): Promise<AdminMatchedChannelDetail> {
    const { data } = await coreClient.getAdminMatchedChannel(roomId);
    if (!data) {
      throw new Error("Matched channel get did not return data");
    }
    return data;
  },

  async addParticipant(
    roomId: string,
    userId: string,
  ): Promise<AdminMatchedChannelParticipant> {
    const { data } = await coreClient.addAdminMatchedChannelParticipant(
      roomId,
      { userId },
    );
    if (!data) {
      throw new Error("Matched channel participant add did not return data");
    }
    return data;
  },

  async addParticipantsFromOrganization(
    roomId: string,
    organization: { organizationId: string } | { organizationSlug: string },
  ): Promise<AdminAddMatchedChannelFromOrganizationResult> {
    const { data } =
      await coreClient.addAdminMatchedChannelParticipantsFromOrganization(
        roomId,
        organization,
      );
    if (!data) {
      throw new Error(
        "Matched channel from-organization add did not return data",
      );
    }
    return data;
  },

  async removeParticipant(
    roomId: string,
    userId: string,
  ): Promise<AdminRemoveMatchedChannelParticipant> {
    const { data } = await coreClient.removeAdminMatchedChannelParticipant(
      roomId,
      userId,
    );
    if (!data) {
      throw new Error("Matched channel participant remove did not return data");
    }
    return data;
  },
};
