import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ExternalChannelDetailPanel } from "@/components/admin/external-channels/external-channel-detail-panel";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { adminExternalChannelsService } from "@/lib/services/admin-external-channels.service";
import { adminOrganizationService } from "@/lib/services/admin-organization.service";

export const metadata: Metadata = {
  title: "External channel",
  description: "Manage guests on an External channel",
};

interface AdminExternalChannelDetailPageProps {
  params: Promise<{ slug: string; roomId: string }>;
}

export default async function AdminExternalChannelDetailPage({
  params,
}: AdminExternalChannelDetailPageProps) {
  const { slug, roomId } = await params;
  const organizationSlug = decodeURIComponent(slug);

  const organization =
    await adminOrganizationService.getOrganizationOptionBySlug(
      organizationSlug,
    );
  if (!organization) {
    notFound();
  }

  let channel: Awaited<
    ReturnType<typeof adminExternalChannelsService.getExternalChannel>
  >;
  try {
    channel = await adminExternalChannelsService.getExternalChannel(
      organizationSlug,
      roomId,
    );
  } catch (error) {
    if (error instanceof CoreApiRequestError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-3xl px-4 py-2">
        <ExternalChannelDetailPanel
          organizationSlug={organizationSlug}
          organizationName={organization.name}
          channel={channel}
        />
      </div>
    </div>
  );
}
