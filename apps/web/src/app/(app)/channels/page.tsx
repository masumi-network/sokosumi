import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/auth.server";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import type { ChatRoom, ChatRoomMessage } from "@/lib/clients/generated/core";
import { chatRoomService, userService } from "@/lib/services";
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

async function loadChannelMessages(channelId: string | null): Promise<{
  messages: ChatRoomMessage[];
  nextCursor: string | null;
  failed: boolean;
}> {
  if (!channelId) {
    return { messages: [], nextCursor: null, failed: false };
  }

  try {
    const page = await chatRoomService.listMessages(channelId);
    return {
      messages: page.messages,
      nextCursor: page.nextCursor,
      failed: false,
    };
  } catch (error) {
    if (error instanceof CoreApiRequestError) {
      console.error("Failed to load channel messages", {
        channelId,
        status: error.status,
        kind: error.kind,
      });
      return { messages: [], nextCursor: null, failed: true };
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

/**
 * When the virtual keyboard opens on mobile, the layout viewport resizes so
 * the channel composer stays above the keyboard. Mirrors the chat route.
 */
export const viewport = {
  interactiveWidget: "resizes-content" as const,
};

export default async function ChannelsPage({
  searchParams,
}: ChannelsPageProps) {
  const [query, t, activeOrganization] = await Promise.all([
    searchParams,
    getTranslations("App.Channels"),
    userService.getActiveOrganization(),
  ]);

  const isCreateChannelRequested = firstSearchValue(query.create) === "channel";
  const isNewDirectMessage = firstSearchValue(query.dm) === "new";

  // Channels / create stay org-only. Start New DM (`?dm=new`) also works in
  // personal workspace: same DraftDirectMessage UI with empty members so the
  // picker is coworkers-only (solo coworker sends via /chat).
  if (!activeOrganization) {
    if (!isNewDirectMessage) {
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

    const [session, coworkers] = await Promise.all([
      getSession(),
      coworkerService.listCoworkers("chat"),
    ]);

    return (
      <ChannelsClient
        activeOrganization={null}
        channels={[]}
        organizationMembers={[]}
        currentUserId={session?.user.id ?? ""}
        coworkers={coworkers}
        selectedChannelId={null}
        isCreateChannelRequested={false}
        isNewDirectMessage
        messageLoadFailed={false}
        messages={[]}
        messagesNextCursor={null}
      />
    );
  }

  const requestedChannelId = firstSearchValue(query.channel);
  const requestedMessagesPromise =
    requestedChannelId && !isCreateChannelRequested && !isNewDirectMessage
      ? loadChannelMessages(requestedChannelId)
      : null;

  const [listedChannels, organizationMembers, coworkers, currentMember] =
    await Promise.all([
      chatRoomService.listRooms(),
      userService.getOrganizationMembers(activeOrganization.id),
      coworkerService.listCoworkers("chat"),
      userService.getMyMemberInOrganization(activeOrganization.id),
    ]);

  // List is capped (default 50). A deep-link outside that page must not fall
  // back to channels[0] — that silently opens the wrong conversation.
  let channels = listedChannels;
  let selectedChannel: ChatRoom | null = null;
  if (!isCreateChannelRequested && !isNewDirectMessage) {
    if (requestedChannelId) {
      selectedChannel =
        channels.find((channel) => channel.id === requestedChannelId) ?? null;
      if (!selectedChannel) {
        const fetched = await chatRoomService.getRoom(requestedChannelId);
        if (!fetched) {
          notFound();
        }
        channels = [fetched, ...channels];
        selectedChannel = fetched;
      }
    } else {
      selectedChannel = channels[0] ?? null;
    }
  }
  const selectedChannelId = selectedChannel?.id ?? null;
  if (requestedMessagesPromise && requestedChannelId !== selectedChannelId) {
    void requestedMessagesPromise.catch((error) => {
      console.error("Failed to load requested channel messages", {
        requestedChannelId,
        error,
      });
    });
  }
  const {
    messages,
    nextCursor: messagesNextCursor,
    failed: messageLoadFailed,
  } = selectedChannelId &&
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
      messagesNextCursor={messagesNextCursor}
    />
  );
}
