"use client";
import type { ChatRoom, ChatRoomInvitation } from "@sokosumi/core-client";
import { Globe2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  acceptChatRoomInvitationAction,
  declineChatRoomInvitationAction,
} from "@/app/chat/actions";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarRowSlot,
} from "@/components/ui/sidebar";
import { SidebarSectionContent } from "@/components/ui/sidebar-section";
import {
  ChatRoomSidebarRow,
  type ChatRoomSidebarRowProps,
} from "./chat-room-sidebar-row";
import { ChatSidebarSectionHeader } from "./chat-sidebar-section-header";
import type { LimitedSectionRooms } from "./limit-sidebar-section-rooms";
import { listOrganizationChatRoomsAction } from "./organization-chat-list.actions";
import { resolveSectionAttention } from "./room-attention";
import { beginRoomAttentionRefresh } from "./room-read-overlay";
import { SidebarSectionShowMoreRow } from "./sidebar-section-show-more-row";
import type { useOrganizationChatRooms } from "./use-organization-chat-rooms";

export function useRoomInvitationActions({
  pendingRows,
  setPendingRows,
  replaceAllRooms,
}: Pick<
  ReturnType<typeof useOrganizationChatRooms>,
  "pendingRows" | "setPendingRows" | "replaceAllRooms"
>) {
  const router = useRouter();
  const tExternal = useTranslations("App.Channels.External");
  const [respondingInvitation, setRespondingInvitation] = useState<
    string | null
  >(null);
  const [_isRespondingInvite, startInviteResponseTransition] = useTransition();
  function handleAcceptInvitation(invitation: ChatRoomInvitation) {
    if (respondingInvitation) {
      return;
    }
    setRespondingInvitation(invitation.id);
    startInviteResponseTransition(async () => {
      const result = await acceptChatRoomInvitationAction(invitation.id);
      if (!result.ok) {
        setRespondingInvitation(null);
        toast.error(result.error.message || tExternal("acceptError"));
        return;
      }
      toast.success(tExternal("acceptSuccess", { name: invitation.roomName }));
      // Drop pending and upsert rooms in the same tick so External does not
      // unmount between the last invite and the joined guest room.
      const requestRevision = beginRoomAttentionRefresh();
      const roomsResult = await listOrganizationChatRoomsAction();
      setRespondingInvitation(null);
      setPendingRows((current) =>
        current.filter((row) => row.id !== invitation.id),
      );
      if (roomsResult.ok) {
        replaceAllRooms(roomsResult.value.rooms, requestRevision);
      }
      router.push(`/chat/rooms/${invitation.roomId}`);
    });
  }

  function handleDeclineInvitation(invitation: ChatRoomInvitation) {
    if (respondingInvitation) {
      return;
    }
    setRespondingInvitation(invitation.id);
    const without = (rows: ChatRoomInvitation[]) =>
      rows.filter((row) => row.id !== invitation.id);
    const index = pendingRows.indexOf(invitation);
    // The row leaves at once. A rejected call is a failed decline too.
    setPendingRows(without);
    startInviteResponseTransition(async () => {
      const result = await declineChatRoomInvitationAction(invitation.id).catch(
        () => null,
      );
      setRespondingInvitation(null);
      // Without again: a list read during the write can bring the row back.
      setPendingRows((rows) =>
        result?.ok
          ? without(rows)
          : without(rows).toSpliced(index, 0, invitation),
      );
      if (result?.ok) toast.success(tExternal("declineSuccess"));
      else toast.error(result?.error.message || tExternal("declineError"));
    });
  }

  return {
    respondingInvitation,
    handleAcceptInvitation,
    handleDeclineInvitation,
  };
}

export function ExternalRoomsSection({
  rooms,
  rows,
  invitations,
  hasPendingInvitation,
  actions,
  open,
  onOpenChange,
  unreadOnly,
  showAll,
  onShowAllChange,
  roomRowProps,
}: {
  rooms: ChatRoom[];
  rows: LimitedSectionRooms<ChatRoom>;
  invitations: readonly ChatRoomInvitation[];
  hasPendingInvitation: boolean;
  actions: ReturnType<typeof useRoomInvitationActions>;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  unreadOnly: boolean;
  showAll: boolean;
  onShowAllChange: (next: boolean) => void;
  roomRowProps: (room: ChatRoom) => ChatRoomSidebarRowProps;
}) {
  const tExternal = useTranslations("App.Channels.External");
  const {
    respondingInvitation,
    handleAcceptInvitation,
    handleDeclineInvitation,
  } = actions;
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <ChatSidebarSectionHeader
        isOpen={open}
        closedAttention={resolveSectionAttention(rooms, {
          hasPendingInvitation,
        })}
      >
        {tExternal("title")}
      </ChatSidebarSectionHeader>
      <SidebarSectionContent>
        <SidebarMenu className="gap-0">
          {invitations.map((invitation) => {
            const anyBusy = respondingInvitation !== null;
            const acceptBusy = respondingInvitation === invitation.id;
            const invitationLabel = tExternal("pendingAria", {
              name: invitation.roomName,
              organization: invitation.organizationName,
            });
            return (
              <SidebarMenuItem key={invitation.id}>
                <div
                  aria-label={invitationLabel}
                  className="text-tertiary-foreground dark:text-muted-foreground flex w-full items-start gap-2 px-2 py-1.5"
                >
                  <SidebarRowSlot>
                    <Globe2 className="text-muted-foreground" aria-hidden />
                  </SidebarRowSlot>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">
                      {invitation.roomName}
                    </div>
                    <div className="text-muted-foreground truncate text-xs leading-tight">
                      {invitation.organizationName}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="default"
                        className="h-6 px-2 text-xs"
                        disabled={anyBusy}
                        loading={acceptBusy}
                        onClick={() => handleAcceptInvitation(invitation)}
                      >
                        {tExternal("accept")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        disabled={anyBusy}
                        onClick={() => handleDeclineInvitation(invitation)}
                      >
                        {tExternal("decline")}
                      </Button>
                    </div>
                  </div>
                </div>
              </SidebarMenuItem>
            );
          })}
          {/* Under the filter these rooms are in its flat list. */}
          {unreadOnly
            ? null
            : rows.visible.map((room) => (
                <ChatRoomSidebarRow key={room.id} {...roomRowProps(room)} />
              ))}
          {!unreadOnly && rows.hiddenCount > 0 ? (
            <SidebarSectionShowMoreRow
              hiddenCount={rows.hiddenCount}
              showAll={showAll}
              onShowAllChange={onShowAllChange}
            />
          ) : null}
        </SidebarMenu>
      </SidebarSectionContent>
    </Collapsible>
  );
}
