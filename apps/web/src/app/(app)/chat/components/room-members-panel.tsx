"use client";

import type { ChatRoom, Coworker, Member } from "@sokosumi/core-client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  addRoomMembersAction,
  type ChatComposeSokoBot,
  leaveRoomAction,
  removeRoomCoworkerAction,
  removeRoomMemberAction,
  removeRoomSokoBotAction,
} from "@/app/chat/actions";
import type { RoomMemberReadState } from "@/app/chat/hooks/use-room-read-receipts";
import {
  canLeaveChannel,
  canManageChannelMembers,
  canRemoveChannelMember,
} from "@/app/chat/utils/channel-member-permissions";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AddRoomMembersDialog } from "./add-room-members-dialog";
import {
  type ChatParticipantHoverProfile,
  getRoomParticipantPreviews,
} from "./room-helpers";
import { RoomRosterPanel } from "./room-roster-panel";

interface RoomMembersPanelProps {
  room: ChatRoom;
  currentUserId: string;
  isOrgOwnerOrAdmin: boolean;
  /** Add picker: the organization roster, Coworkers and the reader's own Soko Bots. */
  organizationMembers: Member[];
  coworkers: Coworker[];
  sokoBots: ChatComposeSokoBot[];
  membersLoadFailed: boolean;
  canOpenHumanDirect: boolean;
  onOpenDirect: (profile: ChatParticipantHoverProfile) => void;
  openingDirectKey: string | null;
  onClose: () => void;
  readStateFor: (userId: string) => RoomMemberReadState | null;
}

/**
 * The room's members panel, and on a Channel where membership is managed:
 * add people, Coworkers and your own Soko Bots, remove whom you may, leave.
 * Directs and matched channels get the read-only roster.
 */
export function RoomMembersPanel({
  room,
  currentUserId,
  isOrgOwnerOrAdmin,
  organizationMembers,
  coworkers,
  sokoBots,
  membersLoadFailed,
  canOpenHumanDirect,
  onOpenDirect,
  openingDirectKey,
  onClose,
  readStateFor,
}: RoomMembersPanelProps) {
  const t = useTranslations("App.Channels");
  const tActions = useTranslations("App.Channels.Actions");
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [pendingRemoval, setPendingRemoval] =
    useState<ChatParticipantHoverProfile | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const canManageMembers = canManageChannelMembers(room);
  const canLeave = canLeaveChannel(room);
  const guestIds = new Set(
    room.userMembers
      .filter((member) => member.access === "guest")
      .map((member) => member.id),
  );

  async function handleUndoRemoval(participant: ChatParticipantHoverProfile) {
    const result = await addRoomMembersAction(
      room.id,
      participant.kind === "coworker"
        ? { coworkerIds: [participant.id] }
        : { sokoBotIds: [participant.id] },
    );
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    router.refresh();
  }

  /** Coworkers and Soko Bots go at once; the toast can put them back. */
  async function removeAgent(participant: ChatParticipantHoverProfile) {
    const result =
      participant.kind === "coworker"
        ? await removeRoomCoworkerAction(room.id, participant.id)
        : await removeRoomSokoBotAction(room.id, participant.id);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    router.refresh();
    toast.success(t("RoomRoster.removeSuccess", { name: participant.name }), {
      duration: Infinity,
      closeButton: true,
      action: {
        label: t("RoomRoster.undo"),
        onClick: () => void handleUndoRemoval(participant),
      },
    });
  }

  function handleRemove(participant: ChatParticipantHoverProfile) {
    if (participant.kind === "human") {
      // A person loses the channel and its history; putting a guest back
      // takes a new invite. So they are confirmed first.
      setPendingRemoval(participant);
      return;
    }
    void removeAgent(participant);
  }

  async function handleConfirmRemoval() {
    if (!pendingRemoval || isRemoving) return;
    setIsRemoving(true);
    const result = await removeRoomMemberAction(room.id, pendingRemoval.id);
    setIsRemoving(false);
    if (!result.ok) {
      toast.error(result.error.message);
      setPendingRemoval(null);
      return;
    }
    toast.success(t("RoomRoster.removeSuccess", { name: pendingRemoval.name }));
    setPendingRemoval(null);
    router.refresh();
  }

  async function handleConfirmLeave() {
    if (isLeaving) return;
    setIsLeaving(true);
    const result = await leaveRoomAction(room.id);
    setIsLeaving(false);
    if (!result.ok) {
      toast.error(result.error.message);
      setLeaveConfirmOpen(false);
      return;
    }
    toast.success(tActions("leaveSuccess", { name: room.name }));
    setLeaveConfirmOpen(false);
    // Empty detail forces a full sidebar refresh (member list + joinables).
    notifyOrganizationChatRoomsChanged();
    // The room is gone for this user, so land them back on the room list
    // rather than a view they can no longer read.
    router.replace("/");
    router.refresh();
  }

  return (
    <>
      <RoomRosterPanel
        participants={getRoomParticipantPreviews(room)}
        currentUserId={currentUserId}
        readStateFor={readStateFor}
        canOpenHumanDirect={canOpenHumanDirect}
        onOpenDirect={onOpenDirect}
        openingDirectKey={openingDirectKey}
        onClose={onClose}
        guestIds={guestIds}
        management={
          canManageMembers || canLeave
            ? {
                onAdd: canManageMembers ? () => setAddOpen(true) : undefined,
                canRemove: (participant) =>
                  canRemoveChannelMember(room, participant, {
                    currentUserId,
                    isOrgOwnerOrAdmin,
                  }),
                onRemove: handleRemove,
                onLeave: canLeave ? () => setLeaveConfirmOpen(true) : undefined,
              }
            : undefined
        }
        labels={{
          title: t("RoomRoster.title"),
          humansTitle: t("RoomRoster.humansTitle"),
          guestsTitle: t("RoomRoster.guestsTitle"),
          agentsTitle: t("RoomRoster.agentsTitle"),
          close: t("RoomRoster.close"),
          readAt: (time) => t("SeenBy.readAt", { time }),
          notRead: t("SeenBy.notRead"),
          empty: t("RoomRoster.empty"),
          coworkerBadge: t("coworkerBadge"),
          personalAssistantBadge: t("personalAssistantBadge"),
          message: (name) => t("RoomRoster.message", { name }),
          copy: (value) => t("RoomRoster.copy", { value }),
          copySuccess: t("RoomRoster.copySuccess"),
          copyError: t("RoomRoster.copyError"),
          add: t("RoomRoster.add"),
          memberActions: (name) => t("RoomRoster.memberActions", { name }),
          remove: t("RoomRoster.remove"),
          leave: tActions("leave"),
        }}
      />

      {canManageMembers ? (
        <AddRoomMembersDialog
          room={room}
          members={organizationMembers}
          coworkers={coworkers}
          sokoBots={sokoBots}
          membersLoadFailed={membersLoadFailed}
          canInviteGuests={room.discoverability === "external"}
          open={addOpen}
          onOpenChange={setAddOpen}
        />
      ) : null}

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isRemoving) setPendingRemoval(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("RoomRoster.removeConfirmTitle", {
                name: pendingRemoval?.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("RoomRoster.removeConfirmDescription", {
                name: pendingRemoval?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>
              {tActions("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isRemoving}
              onClick={(event) => {
                // Keep the confirm mounted while the action runs, so the
                // spinner is visible and a second click cannot double-submit.
                event.preventDefault();
                void handleConfirmRemoval();
              }}
            >
              {isRemoving ? (
                <Loader2
                  className="size-4 animate-spin motion-reduce:animate-pulse"
                  aria-hidden
                />
              ) : null}
              {t("RoomRoster.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={leaveConfirmOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isLeaving) setLeaveConfirmOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tActions("leaveConfirmTitle", { name: room.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tActions("leaveConfirmDescription", { name: room.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLeaving}>
              {tActions("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isLeaving}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmLeave();
              }}
            >
              {isLeaving ? (
                <Loader2
                  className="size-4 animate-spin motion-reduce:animate-pulse"
                  aria-hidden
                />
              ) : null}
              {tActions("leaveConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
