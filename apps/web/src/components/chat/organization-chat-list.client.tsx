"use client";

import { ChevronDown, Hash, MessageCircle, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";
import {
  displaySlugFromMetadata,
  getBucketKeyFromMetadata,
  slugify,
} from "@/app/chat/utils/bucket-slug";
import { CHAT_APP_ROUTE_PREFIX } from "@/app/chat-ui/utils/chat-route-base";
import { PresenceDot } from "@/components/chat/presence-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SheetClose } from "@/components/ui/sheet";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useConversationsContext } from "@/contexts/conversations-context";
import { useCoworkersContext } from "@/contexts/coworkers-context";
import type { Conversation } from "@/lib/actions/conversation";
import type {
  ChatChannel,
  ChatChannelPresence,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";

interface OrganizationChatListProps {
  channels: ChatChannel[];
  currentUserId: string;
  hasOrganization: boolean;
}

interface DirectParticipant {
  id: string;
  name: string;
  image: string | null;
  presence: ChatChannelPresence;
}

interface CoworkerDirectConversation {
  conversationId: string;
  key: string;
  href: string;
  image: string | null;
  name: string;
  updatedAtMs: number;
}

function isCoworkerOnlyDirectChannel(
  channel: ChatChannel,
  currentUserId: string,
) {
  if (channel.kind !== "direct") {
    return false;
  }

  let otherHumanCount = 0;
  for (const member of channel.userMembers) {
    if (member.id !== currentUserId) {
      otherHumanCount += 1;
      if (otherHumanCount > 0) {
        break;
      }
    }
  }

  return otherHumanCount === 0 && channel.coworkerMembers.length === 1;
}

function getDirectParticipants(
  channel: ChatChannel,
  currentUserId: string,
): DirectParticipant[] {
  const humans = channel.userMembers
    .filter((member) => member.id !== currentUserId)
    .map((member) => ({
      id: member.id,
      name: member.name,
      image: member.image,
      presence: member.presence,
    }));

  const coworkers = channel.coworkerMembers.map((coworker) => ({
    id: coworker.id,
    name: coworker.name,
    image: coworker.image,
    presence: coworker.presence,
  }));

  return [...humans, ...coworkers];
}

function getDirectName(channel: ChatChannel, currentUserId: string) {
  const participants = getDirectParticipants(channel, currentUserId);

  if (participants.length === 0) {
    return channel.name;
  }

  return participants.map((participant) => participant.name).join(", ");
}

function buildCoworkerDirectConversations(
  conversations: Conversation[],
  coworkers: ReturnType<typeof useCoworkersContext>["coworkers"],
): CoworkerDirectConversation[] {
  const byBucket = new Map<string, CoworkerDirectConversation>();
  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const coworkersBySlug = new Map(
    coworkers.map((coworker) => [coworker.slug, coworker]),
  );

  for (const conversation of conversations) {
    const metadata =
      (conversation.metadata as Record<string, unknown> | null) ?? null;
    const bucket = getBucketKeyFromMetadata(metadata);
    if (!bucket.startsWith("coworker:")) {
      continue;
    }

    const coworkerId = metadata?.coworker_id as string | undefined;
    const coworkerSlug = metadata?.coworker_slug as string | undefined;
    const coworkerName = metadata?.coworker_name as string | undefined;
    const coworker =
      (coworkerId ? coworkersById.get(coworkerId) : undefined) ??
      (coworkerSlug ? coworkersBySlug.get(coworkerSlug) : undefined);
    const displaySlug =
      displaySlugFromMetadata(metadata) ||
      slugify(coworker?.slug ?? coworkerSlug ?? coworkerName ?? bucket);
    if (!displaySlug) {
      continue;
    }
    const updatedAtMs = new Date(conversation.updatedAt).getTime();

    const row = {
      conversationId: conversation.id,
      key: bucket,
      href: `${CHAT_APP_ROUTE_PREFIX}/${displaySlug}/conversation/${conversation.id}`,
      image: coworker?.avatar ?? null,
      name: coworker?.name ?? coworkerName ?? "Coworker",
      updatedAtMs,
    };

    const existing = byBucket.get(bucket);
    if (!existing || row.updatedAtMs > existing.updatedAtMs) {
      byBucket.set(bucket, row);
    }
  }

  return Array.from(byBucket.values()).sort(
    (left, right) => right.updatedAtMs - left.updatedAtMs,
  );
}

function presenceLabel(
  t: ReturnType<typeof useTranslations<"App.Channels">>,
  presence: ChatChannelPresence,
) {
  if (presence === "online") {
    return t("Presence.online");
  }

  if (presence === "afk") {
    return t("Presence.afk");
  }

  return t("Presence.offline");
}

function DirectAvatarStack({
  channel,
  currentUserId,
}: {
  channel: ChatChannel;
  currentUserId: string;
}) {
  const t = useTranslations("App.Channels");
  const participants = getDirectParticipants(channel, currentUserId).slice(
    0,
    3,
  );

  if (participants.length === 0) {
    return (
      <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium">
        <MessageCircle className="size-3" aria-hidden />
      </span>
    );
  }

  return (
    <span className="inline-flex h-5 shrink-0 items-center">
      {participants.map((participant, index) => (
        <span
          className={cn("relative block", index > 0 && "-ml-2")}
          key={participant.id}
          title={participant.name}
        >
          <Avatar className="border-sidebar-background size-5 border">
            <AvatarImage
              alt={participant.name}
              src={participant.image ?? undefined}
            />
            <AvatarFallback className="text-[9px] font-medium">
              {getInitials(participant.name)}
            </AvatarFallback>
          </Avatar>
          <PresenceDot
            className="-right-0.5 -bottom-0.5 absolute size-2"
            label={presenceLabel(t, participant.presence)}
            presence={participant.presence}
          />
        </span>
      ))}
    </span>
  );
}

function CoworkerDirectAvatar({ row }: { row: CoworkerDirectConversation }) {
  const t = useTranslations("App.Channels");

  return (
    <span className="flex size-5 shrink-0 items-center">
      <span className="relative block size-5">
        <Avatar className="border-sidebar-background size-5 border">
          <AvatarImage alt={row.name} src={row.image ?? undefined} />
          <AvatarFallback className="text-[9px] font-medium">
            {getInitials(row.name)}
          </AvatarFallback>
        </Avatar>
        <PresenceDot
          className="-right-0.5 -bottom-0.5 absolute size-2"
          label={t("Presence.online")}
          presence="online"
        />
      </span>
    </span>
  );
}

function SectionHeader({
  children,
  href,
  isOpen,
  label,
}: {
  children: ReactNode;
  href: string;
  isOpen: boolean;
  label: string;
}) {
  return (
    <div className="group-data-[collapsible=icon]:hidden flex h-8 items-center gap-1 px-2">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex min-w-0 flex-1 items-center gap-1 rounded-md text-left text-xs font-medium transition-colors">
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3 shrink-0 transition-transform",
            !isOpen && "-rotate-90",
          )}
        />
        <span className="truncate">{children}</span>
      </CollapsibleTrigger>
      <SheetClose asChild>
        <Link
          aria-label={label}
          className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex size-6 shrink-0 items-center justify-center rounded-md transition-colors"
          href={href}
        >
          <Plus className="size-3.5" aria-hidden />
        </Link>
      </SheetClose>
    </div>
  );
}

export function OrganizationChatList({
  channels,
  currentUserId,
  hasOrganization,
}: OrganizationChatListProps) {
  const t = useTranslations("App.Channels");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { conversations } = useConversationsContext();
  const { coworkers } = useCoworkersContext();
  const [channelsOpen, setChannelsOpen] = useState(true);
  const [directOpen, setDirectOpen] = useState(true);
  const selectedChannelId = searchParams.get("channel");
  const isChannelsPath = pathname === "/channels";
  const activeConversationId = pathname?.split("/").filter(Boolean).at(-1);

  const { directMessages, publicChannels } = useMemo(() => {
    const directMessages: ChatChannel[] = [];
    const publicChannels: ChatChannel[] = [];

    for (const channel of channels) {
      if (channel.kind === "channel") {
        publicChannels.push(channel);
        continue;
      }

      if (
        channel.kind === "direct" &&
        !isCoworkerOnlyDirectChannel(channel, currentUserId)
      ) {
        directMessages.push(channel);
      }
    }

    return { directMessages, publicChannels };
  }, [channels, currentUserId]);
  const coworkerDirectMessages = useMemo(
    () => buildCoworkerDirectConversations(conversations, coworkers),
    [conversations, coworkers],
  );

  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent className="space-y-2">
        <Collapsible open={channelsOpen} onOpenChange={setChannelsOpen}>
          <SectionHeader
            href="/channels?create=channel"
            isOpen={channelsOpen}
            label={t("createChannel")}
          >
            {t("title")}
          </SectionHeader>
          <CollapsibleContent>
            <SidebarMenu className="gap-0">
              {publicChannels.map((channel) => {
                const isActive =
                  isChannelsPath && selectedChannelId === channel.id;

                return (
                  <SidebarMenuItem key={channel.id}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <SheetClose asChild>
                        <Link
                          aria-current={isActive ? "page" : undefined}
                          className="text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex min-h-auto w-full items-center gap-2 px-3"
                          href={`/channels?channel=${channel.id}`}
                        >
                          <Hash className="size-4 shrink-0" aria-hidden />
                          <span className="flex-1 truncate">
                            {channel.name}
                          </span>
                        </Link>
                      </SheetClose>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              {publicChannels.length === 0 ? (
                <SidebarMenuItem>
                  <div className="text-muted-foreground px-3 py-1.5 text-xs group-data-[collapsible=icon]:hidden">
                    {hasOrganization
                      ? t("Empty.noChannels")
                      : t("Empty.onlyInOrganizations")}
                  </div>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={directOpen} onOpenChange={setDirectOpen}>
          <SectionHeader
            href="/channels?dm=new"
            isOpen={directOpen}
            label={t("Draft.title")}
          >
            {t("directMessages")}
          </SectionHeader>
          <CollapsibleContent>
            <SidebarMenu className="gap-0">
              {directMessages.map((channel) => {
                const isActive =
                  isChannelsPath && selectedChannelId === channel.id;
                const label = getDirectName(channel, currentUserId);
                return (
                  <SidebarMenuItem key={channel.id}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <SheetClose asChild>
                        <Link
                          aria-current={isActive ? "page" : undefined}
                          className="text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex min-h-auto w-full items-center gap-2 px-3"
                          href={`/channels?channel=${channel.id}`}
                        >
                          <DirectAvatarStack
                            channel={channel}
                            currentUserId={currentUserId}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {label}
                          </span>
                        </Link>
                      </SheetClose>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              {coworkerDirectMessages.map((row) => {
                const isActive = activeConversationId === row.conversationId;

                return (
                  <SidebarMenuItem key={row.key}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <SheetClose asChild>
                        <Link
                          aria-current={isActive ? "page" : undefined}
                          className="text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex min-h-auto w-full items-center gap-2 px-3"
                          href={row.href}
                        >
                          <CoworkerDirectAvatar row={row} />
                          <span className="min-w-0 flex-1 truncate">
                            {row.name}
                          </span>
                        </Link>
                      </SheetClose>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              {directMessages.length + coworkerDirectMessages.length === 0 ? (
                <SidebarMenuItem>
                  <div className="text-muted-foreground px-3 py-1.5 text-xs group-data-[collapsible=icon]:hidden">
                    {hasOrganization
                      ? t("Empty.noDirectMessages")
                      : t("Empty.onlyInOrganizations")}
                  </div>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </CollapsibleContent>
        </Collapsible>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
