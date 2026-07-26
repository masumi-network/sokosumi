import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import type { ChatChannelMessage } from "@/lib/clients/generated/core";
import { chatChannelService, userService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";

import { ChannelsClient } from "./components/channels-client";

interface ChannelsPageProps {
  searchParams: Promise<{
    channel?: string | string[];
    create?: string | string[];
    dm?: string | string[];
  }>;
}

function firstSearchValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

async function loadChannelMessages(
  channelId: string | null,
): Promise<{ messages: ChatChannelMessage[]; failed: boolean }> {
  if (!channelId) {
    return { messages: [], failed: false };
  }

  try {
    return {
      messages: await chatChannelService.listMessages(channelId),
      failed: false,
    };
  } catch (error) {
    if (error instanceof CoreApiRequestError) {
      console.error("Failed to load channel messages", {
        channelId,
        status: error.status,
        kind: error.kind,
      });
      return { messages: [], failed: true };
    }

    throw error;
  }
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

  const requestedChannelId = firstSearchValue(query.channel);
  const isCreateChannelRequested = firstSearchValue(query.create) === "channel";
  const isNewDirectMessage = firstSearchValue(query.dm) === "new";
  const requestedMessagesPromise =
    requestedChannelId && !isCreateChannelRequested && !isNewDirectMessage
      ? loadChannelMessages(requestedChannelId)
      : null;

  const [channels, organizationMembers, coworkers, currentMember] =
    await Promise.all([
      chatChannelService.listChannels(activeOrganization.id),
      userService.getOrganizationMembers(activeOrganization.id),
      coworkerService.listCoworkers("chat"),
      userService.getMyMemberInOrganization(activeOrganization.id),
    ]);

  const selectedChannel =
    isCreateChannelRequested || isNewDirectMessage
      ? null
      : (channels.find((channel) => channel.id === requestedChannelId) ??
        channels[0] ??
        null);
  const selectedChannelId = selectedChannel?.id ?? null;
  if (requestedMessagesPromise && requestedChannelId !== selectedChannelId) {
    void requestedMessagesPromise.catch((error) => {
      console.error("Failed to load requested channel messages", {
        requestedChannelId,
        error,
      });
    });
  }
  const { messages, failed: messageLoadFailed } =
    selectedChannelId &&
    requestedChannelId === selectedChannelId &&
    requestedMessagesPromise
      ? await requestedMessagesPromise
      : await loadChannelMessages(selectedChannelId);

  return (
    <ChannelsClient
      activeOrganization={activeOrganization}
      channels={channels}
      organizationMembers={organizationMembers}
      currentUserId={currentMember?.userId ?? ""}
      coworkers={coworkers}
      selectedChannelId={selectedChannelId}
      isCreateChannelRequested={isCreateChannelRequested}
      isNewDirectMessage={isNewDirectMessage}
      messageLoadFailed={messageLoadFailed}
      messages={messages}
    />
  );
}
