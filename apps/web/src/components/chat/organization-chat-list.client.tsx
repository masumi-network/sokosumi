"use client";

import {
  ChevronDown,
  Hash,
  MessageCircle,
  Plus,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { restoreRoomAction } from "@/app/chat/actions";
import { PresenceDot } from "@/components/chat/presence-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT } from "./organization-chat-events";
import {
  listOrganizationArchivedChatRoomsAction,
  listOrganizationChatRoomsAction,
} from "./organization-chat-list.actions";
import { resolveRoomAttention } from "./room-attention";

const ORGANIZATION_CHAT_POLL_MS = 15_000;

interface OrganizationChatListProps {
  rooms: ChatRoom[];
  archivedRooms: ChatRoom[];
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
  room: ChatRoom,
  currentUserId: string,
): DirectParticipant[] {
  const humans = room.userMembers
    .filter((member) => member.id !== currentUserId)
    .map((member) => ({
      id: member.id,
      name: member.name,
      image: member.image,
      presence: member.presence,
    }));

  const coworkers = room.coworkerMembers.map((coworker) => ({
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
export function getDirectRoomDisplayName(
  room: ChatRoom,
  currentUserId: string,
): string {
  if (room.kind !== "direct") {
    return room.name;
  }

  const names = [
    ...room.userMembers
      .filter((member) => member.id !== currentUserId)
      .map((member) => member.name || member.email),
    ...room.coworkerMembers.map((coworker) => coworker.name),
  ];

  if (names.length === 0) {
    const self = room.userMembers[0] ?? null;
    return self?.name || room.name;
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
  room,
  currentUserId,
}: {
  room: ChatRoom;
  currentUserId: string;
}) {
  const t = useTranslations("App.Channels");
  const participants = getDirectParticipants(room, currentUserId).slice(0, 3);

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
  href?: string;
  isOpen: boolean;
  label?: string;
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
      {href && label ? (
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
      ) : null}
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
  rooms,
  archivedRooms,
  currentUserId,
  hasOrganization,
}: OrganizationChatListProps) {
  const t = useTranslations("App.Channels");
  const tActions = useTranslations("App.Channels.Actions");
  const pathname = usePathname();
  const router = useRouter();
  const [roomRows, setRoomRows] = useState(rooms);
  const [archivedRows, setArchivedRows] = useState(archivedRooms);
  const [channelSectionOpen, setChannelSectionOpen] = useState(true);
  const [archivedSectionOpen, setArchivedSectionOpen] = useState(false);
  const [directOpen, setDirectOpen] = useState(true);
  const [restoringRoomId, setRestoringRoomId] = useState<string | null>(null);
  const [_isRestoring, startRestoreTransition] = useTransition();
  const activeRoomId = getActiveRoomIdFromPathname(pathname);

  useEffect(() => {
    setRoomRows(rooms);
  }, [rooms]);

  useEffect(() => {
    setArchivedRows(archivedRooms);
  }, [archivedRooms]);

  useEffect(() => {
    let cancelled = false;

    const refreshRooms = async () => {
      const [activeResult, archivedResult] = await Promise.all([
        listOrganizationChatRoomsAction(),
        hasOrganization
          ? listOrganizationArchivedChatRoomsAction()
          : Promise.resolve({ ok: true as const, data: [] as ChatRoom[] }),
      ]);
      if (cancelled) {
        return;
      }
      if (activeResult.ok) {
        setRoomRows(activeResult.data);
      }
      if (archivedResult.ok) {
        setArchivedRows(archivedResult.data);
      }
    };

    const intervalId = window.setInterval(
      refreshRooms,
      ORGANIZATION_CHAT_POLL_MS,
    );
    window.addEventListener("focus", refreshRooms);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshRooms);
    };
  }, [hasOrganization]);

  useEffect(() => {
    const handleRoomRead = (event: Event) => {
      const detail = (
        event as CustomEvent<{ room?: ChatRoom; roomId?: string }>
      ).detail;
      if (!detail?.roomId) {
        return;
      }

      setRoomRows((current) =>
        current.map((room) =>
          room.id === detail.roomId
            ? (detail.room ?? {
                ...room,
                unreadCount: 0,
                unreadMentionCount: 0,
              })
            : room,
        ),
      );
    };

    window.addEventListener("organization-chat-room-read", handleRoomRead);
    return () => {
      window.removeEventListener("organization-chat-room-read", handleRoomRead);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const handleRoomsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ room?: ChatRoom }>).detail;
      const room = detail?.room;
      if (room) {
        setRoomRows((current) => {
          const without = current.filter((row) => row.id !== room.id);
          return [room, ...without];
        });
        setArchivedRows((current) =>
          current.filter((row) => row.id !== room.id),
        );
        return;
      }

      void Promise.all([
        listOrganizationChatRoomsAction(),
        hasOrganization
          ? listOrganizationArchivedChatRoomsAction()
          : Promise.resolve({ ok: true as const, data: [] as ChatRoom[] }),
      ]).then(([activeResult, archivedResult]) => {
        if (cancelled) {
          return;
        }
        if (activeResult.ok) {
          setRoomRows(activeResult.data);
        }
        if (archivedResult.ok) {
          setArchivedRows(archivedResult.data);
        }
      });
    };

    window.addEventListener(
      ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
      handleRoomsChanged,
    );
    return () => {
      cancelled = true;
      window.removeEventListener(
        ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
        handleRoomsChanged,
      );
    };
  }, [hasOrganization]);

  function handleRestoreRoom(room: ChatRoom) {
    if (restoringRoomId) {
      return;
    }
    setRestoringRoomId(room.id);
    startRestoreTransition(async () => {
      const result = await restoreRoomAction(room.id);
      setRestoringRoomId(null);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(tActions("restoreSuccess", { name: room.name }));
      setArchivedRows((current) => current.filter((row) => row.id !== room.id));
      setRoomRows((current) => {
        const without = current.filter((row) => row.id !== result.data.id);
        return [result.data, ...without];
      });
      router.push(`/chat/rooms/${result.data.id}`);
      router.refresh();
    });
  }

  const { directMessages, namedChannels } = useMemo(() => {
    const directMessages: ChatRoom[] = [];
    const namedChannels: ChatRoom[] = [];

    for (const room of roomRows) {
      if (room.kind === "channel") {
        namedChannels.push(room);
        continue;
      }

      if (room.kind === "direct") {
        directMessages.push(room);
      }
    }

    // Channels: A–Z. DMs: most recent activity first (`updatedAt` bumps on send).
    namedChannels.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    directMessages.sort((a, b) => {
      const byActivity =
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (byActivity !== 0) {
        return byActivity;
      }
      return a.id.localeCompare(b.id);
    });

    return { directMessages, namedChannels };
  }, [roomRows]);

  const sortedArchivedChannels = useMemo(() => {
    return [...archivedRows].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }, [archivedRows]);

  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent className="space-y-2">
        <Collapsible
          open={channelSectionOpen}
          onOpenChange={setChannelSectionOpen}
        >
          <SectionHeader
            href={hasOrganization ? "/chat?create=channel" : undefined}
            isOpen={channelSectionOpen}
            label={t("createChannel")}
          >
            {t("title")}
          </SectionHeader>
          <CollapsibleContent>
            <SidebarMenu className="gap-0">
              {namedChannels.map((room) => {
                const isActive = activeRoomId === room.id;
                const { bold, badgeCount } = resolveRoomAttention({
                  unreadCount: room.unreadCount,
                  unreadMentionCount: room.unreadMentionCount,
                  isActive,
                });

                return (
                  <SidebarMenuItem key={room.id}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <SheetClose asChild>
                        <Link
                          aria-current={isActive ? "page" : undefined}
                          className="text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex min-h-auto w-full items-center gap-2 px-3"
                          href={`/chat/rooms/${room.id}`}
                        >
                          <Hash className="size-4 shrink-0" aria-hidden />
                          <span
                            className={cn(
                              "flex-1 truncate",
                              bold && "font-semibold text-foreground",
                            )}
                          >
                            {room.name}
                          </span>
                          <UnreadBadge count={badgeCount} />
                        </Link>
                      </SheetClose>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              {namedChannels.length === 0 ? (
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

        {hasOrganization && sortedArchivedChannels.length > 0 ? (
          <Collapsible
            open={archivedSectionOpen}
            onOpenChange={setArchivedSectionOpen}
          >
            <SectionHeader isOpen={archivedSectionOpen}>
              {t("archivedChannels")}
            </SectionHeader>
            <CollapsibleContent>
              <SidebarMenu className="gap-0">
                {sortedArchivedChannels.map((room) => {
                  const isRestoring = restoringRoomId === room.id;
                  return (
                    <SidebarMenuItem key={room.id}>
                      <div className="text-tertiary-foreground dark:text-muted-foreground flex min-h-auto w-full items-center gap-2 px-3 py-1.5">
                        <Hash
                          className="size-4 shrink-0 opacity-60"
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {room.name}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="group-data-[collapsible=icon]:hidden h-7 shrink-0 gap-1 px-2 text-xs"
                          disabled={isRestoring || restoringRoomId !== null}
                          onClick={() => handleRestoreRoom(room)}
                          aria-label={`${tActions("restore")} ${room.name}`}
                        >
                          <RotateCcw
                            className={cn(
                              "size-3",
                              isRestoring && "animate-spin",
                            )}
                            aria-hidden
                          />
                          {tActions("restore")}
                        </Button>
                      </div>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        <Collapsible open={directOpen} onOpenChange={setDirectOpen}>
          {/*
            Sidebar rows = messaged history only. `+` opens Start New DM
            (`/chat?dm=new`): org members + coworkers (1:1 only). Personal
            workspace soft-gates named channels but still mounts the same draft
            with empty members (coworkers only).
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
              {directMessages.map((room) => {
                const isActive = activeRoomId === room.id;
                const label = getDirectRoomDisplayName(room, currentUserId);
                const { bold, badgeCount } = resolveRoomAttention({
                  unreadCount: room.unreadCount,
                  unreadMentionCount: room.unreadMentionCount,
                  isActive,
                });
                return (
                  <SidebarMenuItem key={room.id}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <SheetClose asChild>
                        <Link
                          aria-current={isActive ? "page" : undefined}
                          className="text-tertiary-foreground dark:text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex min-h-auto w-full items-center gap-2 px-3"
                          href={`/chat/rooms/${room.id}`}
                        >
                          <DirectAvatarStack
                            room={room}
                            currentUserId={currentUserId}
                          />
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate",
                              bold && "font-semibold text-foreground",
                            )}
                          >
                            {label}
                          </span>
                          <UnreadBadge count={badgeCount} />
                        </Link>
                      </SheetClose>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              {directMessages.length === 0 ? (
                <SidebarMenuItem>
                  <div className="text-muted-foreground px-3 py-1.5 text-xs group-data-[collapsible=icon]:hidden">
                    {t("Empty.noDirectMessages")}
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
