"use client";

import type { ChatRoom, Coworker, Member } from "@sokosumi/core-client";
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

/** One id space per kind: a Coworker and a Soko Bot can share an id. */
function participantKey(participant: ChatParticipantHoverProfile): string {
  return `${participant.kind}:${participant.id}`;
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
  // Coworkers and Soko Bots with a removal sent to Core. They are off the
  // roster at once, and stay off until the room no longer lists them.
  const [removingAgents, setRemovingAgents] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const participants = getRoomParticipantPreviews(room);
  const listedKeys = new Set(participants.map(participantKey));
  if ([...removingAgents].some((key) => !listedKeys.has(key))) {
    setRemovingAgents(
      new Set([...removingAgents].filter((key) => listedKeys.has(key))),
    );
  }
  function showAgent(participant: ChatParticipantHoverProfile) {
    setRemovingAgents((current) => {
      const next = new Set(current);
      next.delete(participantKey(participant));
      return next;
    });
  }
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
    // If the room still lists the agent (its refresh has not landed), the
    // agent shows again at once.
    showAgent(participant);
    const result = await addRoomMembersAction(
      room.id,
      participant.kind === "coworker"
        ? { coworkerIds: [participant.id] }
        : { sokoBotIds: [participant.id] },
    ).catch(() => null);
    if (!result?.ok) {
      // The roster shows what the room says from here.
      toast.error(
        result?.error.message ??
          t("RoomRoster.undoError", { name: participant.name }),
      );
      return;
    }
  }

  /** Coworkers and Soko Bots go at once; the toast can put them back. */
  async function removeAgent(participant: ChatParticipantHoverProfile) {
    setRemovingAgents((current) =>
      new Set(current).add(participantKey(participant)),
    );
    // A rejected call is a failed write too: the agent must not stay off
    // the roster when Core never removed it.
    const result = await (participant.kind === "coworker"
      ? removeRoomCoworkerAction(room.id, participant.id)
      : removeRoomSokoBotAction(room.id, participant.id)
    ).catch(() => null);
    if (!result?.ok) {
      showAgent(participant);
      toast.error(
        result?.error.message ??
          t("RoomRoster.removeError", { name: participant.name }),
      );
      return;
    }
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
  }

  return (
    <>
      <RoomRosterPanel
        participants={participants.filter(
          (participant) => !removingAgents.has(participantKey(participant)),
        )}
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
              loading={isRemoving}
              onClick={(event) => {
                // Keep the confirm mounted while the action runs, so the
                // loading bar is visible and a second click cannot double-submit.
                event.preventDefault();
                void handleConfirmRemoval();
              }}
            >
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
              loading={isLeaving}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmLeave();
              }}
            >
              {tActions("leaveConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
