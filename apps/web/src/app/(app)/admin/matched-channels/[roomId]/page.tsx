import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MatchedChannelDetailPanel } from "@/components/admin/matched-channels/matched-channel-detail-panel";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { adminMatchedChannelsService } from "@/lib/services/admin-matched-channels.service";
import { userService } from "@/lib/services/user.service";

export const metadata: Metadata = {
  title: "Matched channel",
  description: "Manage participants on a matched channel",
};

interface AdminMatchedChannelDetailPageProps {
  params: Promise<{ roomId: string }>;
}

export default async function AdminMatchedChannelDetailPage({
  params,
}: AdminMatchedChannelDetailPageProps) {
  const { roomId } = await params;

  const memberships = await userService.getMyMembersWithOrganizations();
  const memberOrganizationIds = memberships.map(
    (membership) => membership.organizationId,
  );

  let channel: Awaited<
    ReturnType<typeof adminMatchedChannelsService.getMatchedChannel>
  >;
  try {
    channel = await adminMatchedChannelsService.getMatchedChannel(roomId);
  } catch (error) {
    if (error instanceof CoreApiRequestError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-3xl px-4 py-2">
        <MatchedChannelDetailPanel
          channel={channel}
          memberOrganizationIds={memberOrganizationIds}
        />
      </div>
    </div>
  );
}
