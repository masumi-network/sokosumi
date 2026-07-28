"use client";

import { ChevronDown, Hash, MessageCircle, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useMemo, useState } from "react";
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
import type { ChatRoom, ChatRoomPresence } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";
import { listOrganizationChatChannelsAction } from "./organization-chat-list.actions";

const ORGANIZATION_CHAT_POLL_MS = 15_000;

interface OrganizationChatListProps {
  channels: ChatRoom[];
  currentUserId: string;
  hasOrganization: boolean;
}

interface DirectParticipant {
  id: string;
  name: string;
  image: string | null;
  presence: ChatRoomPresence;
}

function getDirectParticipants(
  channel: ChatRoom,
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

const DIRECT_NAME_PREVIEW_LIMIT = 3;

/**
 * Single source of truth for direct-channel titles: the sidebar and the
 * channels pane must never label the same conversation differently.
 */
export function getDirectChannelDisplayName(
  channel: ChatRoom,
  currentUserId: string,
): string {
  if (channel.kind !== "direct") {
    return channel.name;
  }

  const names = [
    ...channel.userMembers
      .filter((member) => member.id !== currentUserId)
      .map((member) => member.name || member.email),
    ...channel.coworkerMembers.map((coworker) => coworker.name),
  ];

  if (names.length === 0) {
    const self = channel.userMembers[0] ?? null;
    return self?.name || channel.name;
  }

  if (names.length <= DIRECT_NAME_PREVIEW_LIMIT) {
    return names.join(", ");
  }

  const shown = names.slice(0, DIRECT_NAME_PREVIEW_LIMIT);
  return `${shown.join(", ")} and ${names.length - shown.length} more`;
}

function presenceLabel(
  t: ReturnType<typeof useTranslations<"App.Channels">>,
  presence: ChatRoomPresence,
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
  channel: ChatRoom;
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

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }

  const label = count > 99 ? "99+" : String(count);

  return (
    <span
      aria-label={`${label} unread`}
      className="bg-primary text-primary-foreground group-data-[collapsible=icon]:hidden inline-flex min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-4 tabular-nums"
    >
      {label}
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
          // The only entry point for creating a channel or DM. 24px is well
          // under a comfortable tap target, so widen the hit area on touch with
          // an invisible inset rather than changing how the row looks.
          className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground relative flex size-6 shrink-0 items-center justify-center rounded-md transition-colors before:absolute before:-inset-2 before:content-[''] sm:before:hidden"
          href={href}
        >
          <Plus className="size-3.5" aria-hidden />
        </Link>
      </SheetClose>
    </div>
  );
}

function getActiveRoomIdFromPathname(pathname: string | null): string | null {
  if (!pathname?.startsWith("/chat/rooms/")) {
    return null;
  }

  const roomId = pathname.split("/")[3];
  return roomId || null;
}

export function OrganizationChatList({
  channels,
  currentUserId,
  hasOrganization,
}: OrganizationChatListProps) {
  const t = useTranslations("App.Channels");
  const pathname = usePathname();
  const [channelRows, setChannelRows] = useState(channels);
  const [channelsOpen, setChannelsOpen] = useState(true);
  const [directOpen, setDirectOpen] = useState(true);
  const activeRoomId = getActiveRoomIdFromPathname(pathname);

  useEffect(() => {
    setChannelRows(channels);
  }, [channels]);

  useEffect(() => {
    if (!hasOrganization) {
      return;
    }

    let cancelled = false;

    const refreshChannels = async () => {
      const result = await listOrganizationChatChannelsAction();
      if (!cancelled && result.ok) {
        setChannelRows(result.data);
      }
    };

    const intervalId = window.setInterval(
      refreshChannels,
      ORGANIZATION_CHAT_POLL_MS,
    );
    window.addEventListener("focus", refreshChannels);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshChannels);
    };
  }, [hasOrganization]);

  useEffect(() => {
    const handleChannelRead = (event: Event) => {
      const detail = (
        event as CustomEvent<{ channel?: ChatRoom; channelId?: string }>
      ).detail;
      if (!detail?.channelId) {
        return;
      }

      setChannelRows((current) =>
        current.map((channel) =>
          channel.id === detail.channelId
            ? (detail.channel ?? { ...channel, unreadCount: 0 })
            : channel,
        ),
      );
    };

    window.addEventListener(
      "organization-chat-channel-read",
      handleChannelRead,
    );
    return () => {
      window.removeEventListener(
        "organization-chat-channel-read",
        handleChannelRead,
      );
    };
  }, []);

  const { directMessages, publicChannels } = useMemo(() => {
    const directMessages: ChatRoom[] = [];
    const publicChannels: ChatRoom[] = [];

    for (const channel of channelRows) {
      if (channel.kind === "channel") {
        publicChannels.push(channel);
        continue;
      }

      if (channel.kind === "direct") {
        directMessages.push(channel);
      }
    }

    return { directMessages, publicChannels };
  }, [channelRows]);

  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent className="space-y-2">
        <Collapsible open={channelsOpen} onOpenChange={setChannelsOpen}>
          <SectionHeader
            href="/chat?create=channel"
            isOpen={channelsOpen}
            label={t("createChannel")}
          >
            {t("title")}
          </SectionHeader>
          <CollapsibleContent>
            <SidebarMenu className="gap-0">
              {publicChannels.map((channel) => {
                const isActive = activeRoomId === channel.id;
                const unreadCount = isActive ? 0 : channel.unreadCount;

                return (
                  <SidebarMenuItem key={channel.id}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <SheetClose asChild>
                        <Link
                          aria-current={isActive ? "page" : undefined}
                          className="text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex min-h-auto w-full items-center gap-2 px-3"
                          href={`/chat/rooms/${channel.id}`}
                        >
                          <Hash className="size-4 shrink-0" aria-hidden />
                          <span className="flex-1 truncate">
                            {channel.name}
                          </span>
                          <UnreadBadge count={unreadCount} />
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
          {/*
            Sidebar rows = messaged history only. `+` opens Start New DM
            (`/chat?dm=new`): org members + coworkers (+ group). Personal
            workspace soft-gates channels but still mounts the same draft with
            empty members (coworkers only).
          */}
          <SectionHeader
            href="/chat?dm=new"
            isOpen={directOpen}
            label={t("Draft.title")}
          >
            {t("directMessages")}
          </SectionHeader>
          <CollapsibleContent>
            <SidebarMenu className="gap-0">
              {directMessages.map((channel) => {
                const isActive = activeRoomId === channel.id;
                const label = getDirectChannelDisplayName(
                  channel,
                  currentUserId,
                );
                const unreadCount = isActive ? 0 : channel.unreadCount;
                return (
                  <SidebarMenuItem key={channel.id}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <SheetClose asChild>
                        <Link
                          aria-current={isActive ? "page" : undefined}
                          className="text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex min-h-auto w-full items-center gap-2 px-3"
                          href={`/chat/rooms/${channel.id}`}
                        >
                          <DirectAvatarStack
                            channel={channel}
                            currentUserId={currentUserId}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {label}
                          </span>
                          <UnreadBadge count={unreadCount} />
                        </Link>
                      </SheetClose>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              {directMessages.length === 0 ? (
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
