import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { coreClient } from "@/lib/clients/core.client";
import { chatChannelService, userService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";

import { ChannelsClient } from "./components/channels-client";

interface ChannelsPageProps {
  searchParams: Promise<{
    channel?: string | string[];
    dm?: string | string[];
  }>;
}

function firstSearchValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Channels.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function ChannelsPage({
  searchParams,
}: ChannelsPageProps) {
  const [query, t, activeOrganization] = await Promise.all([
    searchParams,
    getTranslations("App.Channels"),
    userService.getActiveOrganization(),
  ]);

  if (!activeOrganization) {
    return (
      <div className="min-h-full w-full px-4 py-6">
        <div className="mx-auto max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle>{t("NoOrganization.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                {t("NoOrganization.description")}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const [channels, organizationMembers, coworkers, currentMember] =
    await Promise.all([
      chatChannelService.listChannels(activeOrganization.id),
      coreClient
        .getOrganizationMembers(activeOrganization.id)
        .then((response) => response.data),
      coworkerService.listCoworkers("chat"),
      userService.getMyMemberInOrganization(activeOrganization.id),
    ]);

  const requestedChannelId = firstSearchValue(query.channel);
  const isNewDirectMessage = firstSearchValue(query.dm) === "new";
  const selectedChannel = isNewDirectMessage
    ? null
    : (channels.find((channel) => channel.id === requestedChannelId) ??
      channels[0] ??
      null);
  const messages = selectedChannel
    ? await chatChannelService.listMessages(selectedChannel.id)
    : [];

  return (
    <ChannelsClient
      activeOrganization={activeOrganization}
      channels={channels}
      organizationMembers={organizationMembers}
      currentUserId={currentMember?.userId ?? ""}
      coworkers={coworkers}
      selectedChannelId={selectedChannel?.id ?? null}
      isNewDirectMessage={isNewDirectMessage}
      messages={messages}
    />
  );
}
